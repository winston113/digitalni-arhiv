import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIL_SECURITY, type MailSecurity } from '../shared/mail.js';
import { normalizeIssuer, OIDC_METHODS, type OidcMethod } from '../shared/oidc.js';
import type { Smtp } from './mail.js';
import type { OidcConfig } from './oidc.js';

export interface Config {
  port: number;
  baseUrl: string;
  dataDir: string;
  secret: string;
  trustProxy: boolean;
  storageLimit: number | null;
  registration: boolean;
  oidc: OidcConfig | null;
  smtp: Smtp | null;
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} mora biti true ali false.`);
}

function positive(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error('STORAGE_LIMIT_MB mora biti pozitivno število.');
  return n;
}

function oidcMethod(env: NodeJS.ProcessEnv): OidcMethod {
  const value = env.OIDC_METHOD || (env.OIDC_CLIENT_SECRET ? 'client_secret_post' : 'none');
  if (!(OIDC_METHODS as readonly string[]).includes(value)) throw new Error('OIDC_METHOD mora biti none, client_secret_basic ali client_secret_post.');
  if (value !== 'none' && !env.OIDC_CLIENT_SECRET) throw new Error('Za izbrani OIDC_METHOD je potrebna OIDC_CLIENT_SECRET.');
  return value as OidcMethod;
}

function smtpSecurity(env: NodeJS.ProcessEnv, port: number): MailSecurity {
  const value = env.SMTP_SECURITY || (port === 465 ? 'tls' : 'starttls');
  if (!(MAIL_SECURITY as readonly string[]).includes(value)) throw new Error('SMTP_SECURITY mora biti starttls, tls ali none.');
  return value as MailSecurity;
}

// Skrivnost za seje: iz okolja ali samodejno ustvarjena v podatkovni mapi.
function loadSecret(env: NodeJS.ProcessEnv, dataDir: string): string {
  if (env.SECRET) {
    if (env.SECRET.length < 32) throw new Error('SECRET mora imeti vsaj 32 znakov.');
    return env.SECRET;
  }
  const path = join(dataDir, 'secret');
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(path, 'utf8').trim();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.DATA_DIR || './data';
  mkdirSync(join(dataDir, 'files'), { recursive: true });

  const port = Number(env.PORT || 3000);
  const baseUrl = new URL(env.BASE_URL || `http://localhost:${port}`).origin;

  const { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: clientId } = env;
  if (Boolean(issuer) !== Boolean(clientId)) throw new Error('OIDC_ISSUER in OIDC_CLIENT_ID morata biti nastavljena skupaj.');
  const smtpPort = Number(env.SMTP_PORT || 587);
  const { SMTP_HOST: host, SMTP_FROM: from } = env;
  if (Boolean(host) !== Boolean(from)) throw new Error('SMTP_HOST in SMTP_FROM morata biti nastavljena skupaj.');

  const config: Config = {
    port, baseUrl, dataDir,
    secret: loadSecret(env, dataDir),
    trustProxy: flag(env, 'TRUST_PROXY', false),
    storageLimit: env.STORAGE_LIMIT_MB ? positive(env.STORAGE_LIMIT_MB) * 1024 * 1024 : null,
    registration: flag(env, 'REGISTRATION', true),
    oidc: issuer && clientId
      ? { issuer: normalizeIssuer(issuer), clientId, method: oidcMethod(env), clientSecret: env.OIDC_CLIENT_SECRET || undefined, name: env.OIDC_NAME || 'OpenID Connect', scopes: env.OIDC_SCOPES || 'openid profile email', registration: flag(env, 'OIDC_REGISTRATION', true) }
      : null,
    smtp: host && from
      ? { host, port: smtpPort, security: smtpSecurity(env, smtpPort), user: env.SMTP_USER ?? '', password: env.SMTP_PASSWORD ?? '', from, fromName: env.SMTP_FROM_NAME ?? '' }
      : null,
  };
  if (env.LOCAL_LOGIN) console.warn('LOCAL_LOGIN ni več podprt: prijava z geslom je vedno na voljo kot rezerva.');
  return config;
}
