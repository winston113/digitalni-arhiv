import nodemailer from 'nodemailer';
import type { Config } from './config.js';

export type SendMail = (to: string, subject: string, text: string) => Promise<void>;

export function createMailer(smtp: NonNullable<Config['smtp']>): SendMail {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  return async (to, subject, text) => {
    await transport.sendMail({ from: smtp.from, to, subject, text });
  };
}
