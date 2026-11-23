import { STAGES, stageOf, type Stage } from '../shared/reminders.js';
import { sortByDeadline, toView, type ContractView } from '../shared/contracts.js';
import { formatDate, pluralDays, today } from '../shared/dates.js';
import { toLang, translate, type Lang } from '../shared/i18n.js';
import type { Config } from './config.js';
import type { ContractStore } from './contracts.js';
import type { Db } from './db.js';
import type { Mail } from './mail.js';
import type { Settings } from './settings.js';

interface Recipient { id: string; name: string; email: string; language: string }
interface Due { contract: ContractView; stage: Stage }

const HOUR = 3_600_000;

function line(lang: Lang, { contract: c, stage }: Due, baseUrl: string): string {
  const end = formatDate(c.endDate!, lang);
  const action = formatDate(c.actionDate!, lang);
  const when = stage === 'potekla' ? translate(lang, 'pogodba je potekla {end}', { end })
    : (c.daysLeft ?? 0) < 0 ? translate(lang, 'rok za ukrepanje je minil {action}, pogodba poteče {end}', { action, end })
    : c.daysLeft === 0 ? translate(lang, 'rok za ukrepanje je danes')
    : translate(lang, 'rok za ukrepanje je {action}, čez {days}', { action, days: pluralDays(c.daysLeft!, lang) });
  return `${c.title} (${c.party})\n${when}\n${baseUrl}/pogodbe/${c.id}`.replace(/\u00a0/g, ' ');
}

function subject(lang: Lang, n: number): string {
  if (lang === 'en') return n === 1 ? '1 contract needs action' : `${n} contracts need action`;
  const r = n % 100;
  return `${n} ${r === 1 ? 'pogodba zahteva' : r === 2 ? 'pogodbi zahtevata' : r === 3 || r === 4 ? 'pogodbe zahtevajo' : 'pogodb zahteva'} ukrepanje`;
}

export function composeReminder(lang: Lang, name: string, due: Due[], baseUrl: string): { subject: string; text: string } {
  return {
    subject: subject(lang, due.length),
    text: translate(lang, 'Pozdravljeni, {name},\n\npodaljšajte ali prekinite naslednje pogodbe:\n\n{list}\n\nOpozorila po e-pošti izklopite na {url}\n', {
      name, list: due.map((d) => line(lang, d, baseUrl)).join('\n\n'), url: `${baseUrl}/racun`,
    }),
  };
}

// Enkrat na dan pošlje vsakemu uporabniku en povzetek novih opozoril.
export class Reminders {
  private current: Promise<{ sent: number; failed: number }> | null = null;

  constructor(private config: Config, private db: Db, private contracts: ContractStore, private mail: Mail, private settings: Settings) {}

  // Samo dejavni uporabniki s potrjenim naslovom, da sporočil ni mogoče usmeriti na tuj naslov.
  private recipients(): Recipient[] {
    return this.db.prepare(`SELECT u.id, u.name, u.email, a.language FROM user u JOIN user_access a ON a.user_id = u.id
      WHERE u.emailVerified = 1 AND a.disabled = 0 AND a.reminders = 1`).all() as Recipient[];
  }

  due(userId: string, now: string): Due[] {
    const sent = this.db.prepare('SELECT 1 FROM reminders WHERE contract_id = ? AND end_date = ? AND stage = ?');
    return this.contracts.list(userId).map((c) => toView(c, now)).sort(sortByDeadline).flatMap((contract) => {
      const stage = stageOf(contract);
      return stage && !sent.get(contract.id, contract.endDate, stage) ? [{ contract, stage }] : [];
    });
  }

  // Poslana stopnja zajame tudi prejšnje, da se ne pošljejo za nazaj.
  private markSent(due: Due[]): void {
    const insert = this.db.prepare('INSERT OR IGNORE INTO reminders (contract_id, end_date, stage, sent_at) VALUES (?, ?, ?, ?)');
    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const { contract, stage } of due) {
        for (const s of STAGES.slice(0, STAGES.indexOf(stage) + 1)) insert.run(contract.id, contract.endDate, s, now);
      }
    })();
  }

  // Ročni in dnevni zagon si delita isto izvajanje, da se nič ne pošlje dvakrat.
  run(now = today()): Promise<{ sent: number; failed: number }> {
    this.current ??= this.sendAll(now).finally(() => { this.current = null; });
    return this.current;
  }

  private async sendAll(now: string): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const user of this.recipients()) {
      const due = this.due(user.id, now);
      if (due.length === 0) continue;
      try {
        await this.mail.send({ to: user.email, ...composeReminder(toLang(user.language), user.name, due, this.config.baseUrl) });
        this.markSent(due);
        sent++;
      } catch (error) {
        failed++;
        console.error('Opozorila ni bilo mogoče poslati:', error instanceof Error ? error.message : error);
      }
    }
    this.settings.set('reminders-last', { at: new Date().toISOString(), sent, failed });
    return { sent, failed };
  }

  // Neuspelo pošiljanje se ponovi po eni uri; uspešno opravljen dan se ne ponovi.
  async tick(now = new Date()): Promise<void> {
    if (this.current || !this.mail.canRemind || now.getHours() < this.mail.uses.reminderHour) return;
    const day = today(now);
    if (this.settings.get<string>('reminders-day') === day) return;
    if (now.getTime() < (this.settings.get<number>('reminders-retry') ?? 0)) return;
    const { failed } = await this.run(day);
    if (failed === 0) this.settings.set('reminders-day', day);
    else this.settings.set('reminders-retry', now.getTime() + HOUR);
  }

  start(): NodeJS.Timeout {
    const safe = () => { this.tick().catch((error) => console.error('Opozorila:', error)); };
    setTimeout(safe, 15_000).unref();
    const timer = setInterval(safe, 5 * 60_000);
    timer.unref();
    return timer;
  }
}
