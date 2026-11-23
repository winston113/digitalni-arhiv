import nodemailer, { type Transporter } from 'nodemailer';
import type { MailInput, MailSecurity, MailUses, MailView } from '../shared/mail.js';
import type { Config } from './config.js';
import type { Settings } from './settings.js';

export interface Smtp { host: string; port: number; security: MailSecurity; user: string; password: string; from: string; fromName: string }
export interface Message { to: string; subject: string; text: string }
export type Deliver = (smtp: Smtp, message: Message) => Promise<void>;

type Stored = Omit<MailInput, 'password'> & { password: string | null };

const DEFAULT_USES: MailUses = { passwordReset: true, reminders: true, reminderHour: 8 };
const APP_NAME = 'Digitalni arhiv pogodb';

function smtpDeliver(): Deliver {
  let cached: { key: string; transport: Transporter } | null = null;
  return async (smtp, message) => {
    const key = JSON.stringify(smtp);
    if (cached?.key !== key) {
      cached?.transport.close();
      cached = {
        key,
        transport: nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.security === 'tls',
          requireTLS: smtp.security === 'starttls',
          ignoreTLS: smtp.security === 'none',
          auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
          connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
          disableFileAccess: true, disableUrlAccess: true,
        }),
      };
    }
    await cached.transport.sendMail({ from: { name: smtp.fromName || APP_NAME, address: smtp.from }, ...message });
  };
}

// Strežnik pošte je nastavljen v okolju ali v skrbniškem delu; okolje ima prednost.
export class Mail {
  constructor(private config: Config, private settings: Settings, private deliver: Deliver = smtpDeliver()) {}

  private smtp(): Smtp | null {
    if (this.config.smtp) return this.config.smtp;
    const stored = this.settings.get<Stored>('mail');
    if (!stored) return null;
    const password = stored.password === null ? '' : this.settings.decrypt(stored.password);
    return password === null ? null : { ...stored, password };
  }

  get uses(): MailUses { return { ...DEFAULT_USES, ...this.settings.get<MailUses>('mail-uses') }; }
  setUses(uses: MailUses): void { this.settings.set('mail-uses', uses); }

  get ready(): boolean { return this.smtp() !== null; }
  get canReset(): boolean { return this.ready && this.config.localLogin && this.uses.passwordReset; }
  get canRemind(): boolean { return this.ready && this.uses.reminders; }

  view(): MailView {
    const stored = this.settings.get<Stored>('mail');
    const smtp = this.config.smtp ?? stored;
    return {
      source: this.config.smtp ? 'env' : stored ? 'panel' : 'none',
      settings: smtp && { host: smtp.host, port: smtp.port, security: smtp.security, user: smtp.user, from: smtp.from, fromName: smtp.fromName, hasPassword: Boolean(smtp.password) },
      uses: this.uses,
      lastRun: this.settings.get<MailView['lastRun']>('reminders-last'),
    };
  }

  save({ password, ...rest }: MailInput): void {
    const old = this.settings.get<Stored>('mail');
    // Shranjeno geslo velja samo za isti strežnik in uporabnika, sicer bi ga bilo mogoče poslati drugam.
    const same = old && old.host === rest.host && old.port === rest.port && old.user === rest.user && old.security === rest.security;
    const kept = same ? old.password : null;
    const next: Stored = { ...rest, password: password === null ? kept : password ? this.settings.encrypt(password) : null };
    this.settings.set('mail', next);
  }

  clear(): void { this.settings.remove('mail'); }

  async send(message: Message): Promise<void> {
    const smtp = this.smtp();
    if (!smtp) throw new Error('Pošta ni nastavljena.');
    await this.deliver(smtp, message);
  }

  // Za sporočila, pri katerih odzivni čas ne sme razkriti, ali račun obstaja.
  sendLater(message: Message): void {
    this.send(message).catch((error) => console.error('Pošiljanje sporočila ni uspelo:', error instanceof Error ? error.message : error));
  }
}

export function mailError(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; response?: string };
  const detail = e.response ? ` Odgovor strežnika: ${e.response.slice(0, 200)}` : '';
  switch (e.code) {
    case 'EAUTH': return `Strežnik je zavrnil prijavo. Preverite uporabniško ime in geslo.${detail}`;
    case 'EDNS': case 'ENOTFOUND': return 'Strežnika s tem naslovom ni mogoče najti.';
    case 'ETIMEDOUT': case 'ECONNECTION': case 'ECONNREFUSED': case 'ESOCKET': case 'ETLS': return 'Povezava s strežnikom ni uspela. Preverite naslov, vrata in način šifriranja.';
    case 'EENVELOPE': case 'EMESSAGE': return `Strežnik je zavrnil pošiljatelja ali prejemnika.${detail}`;
    default: return `Pošiljanje ni uspelo.${detail}`;
  }
}
