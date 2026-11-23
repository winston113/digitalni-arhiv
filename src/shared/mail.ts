import { z } from 'zod';

export const MAIL_SECURITY = ['starttls', 'tls', 'none'] as const;
export type MailSecurity = (typeof MAIL_SECURITY)[number];

const host = z.string({ error: 'Vnesite naslov strežnika.' }).trim().min(1, { error: 'Vnesite naslov strežnika.' }).max(253, { error: 'Naslov strežnika je predolg.' })
  .regex(/^[A-Za-z0-9.:-]+$/, { error: 'Vnesite samo ime strežnika, na primer in-v3.mailjet.com.' });

export const mailInput = z.object({
  host,
  port: z.number({ error: 'Vnesite vrata od 1 do 65535.' }).int({ error: 'Vnesite vrata od 1 do 65535.' }).min(1, { error: 'Vnesite vrata od 1 do 65535.' }).max(65535, { error: 'Vnesite vrata od 1 do 65535.' }),
  security: z.enum(MAIL_SECURITY, { error: 'Izberite način šifriranja.' }),
  user: z.string().trim().max(200, { error: 'Uporabniško ime je predolgo.' }),
  // null: obdrži shranjeno geslo.
  password: z.string().max(500, { error: 'Geslo je predolgo.' }).nullable(),
  from: z.string({ error: 'Vnesite naslov pošiljatelja.' }).trim().pipe(z.email({ error: 'Vnesite veljaven e-poštni naslov.' })),
  fromName: z.string().trim().max(100, { error: 'Ime je predolgo. Največ 100 znakov.' }).regex(/^[^\r\n"<>]*$/, { error: 'Ime vsebuje nedovoljene znake.' }),
});
export type MailInput = z.infer<typeof mailInput>;

export const mailUses = z.object({
  passwordReset: z.boolean(),
  reminders: z.boolean(),
  reminderHour: z.number({ error: 'Izberite uro.' }).int().min(0, { error: 'Izberite uro.' }).max(23, { error: 'Izberite uro.' }),
});
export type MailUses = z.infer<typeof mailUses>;

export interface MailView {
  source: 'none' | 'env' | 'panel';
  settings: (Omit<MailInput, 'password'> & { hasPassword: boolean }) | null;
  uses: MailUses;
  lastRun: { at: string; sent: number; failed: number } | null;
}
