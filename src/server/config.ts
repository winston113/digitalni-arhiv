import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Config {
  port: number;
  baseUrl: string;
  dataDir: string;
  secret: string;
  trustProxy: boolean;
  registration: boolean;
  localLogin: boolean;
  oidc: { issuer: string; clientId: string; clientSecret?: string; name: string; registration: boolean } | null;
  smtp: { host: string; port: number; user?: string; password?: string; from: string } | null;
}

function flag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} mora biti true ali false.`);
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
  const { SMTP_HOST: host, SMTP_FROM: from } = env;
  if (Boolean(host) !== Boolean(from)) throw new Error('SMTP_HOST in SMTP_FROM morata biti nastavljena skupaj.');

  const config: Config = {
    port, baseUrl, dataDir,
    secret: loadSecret(env, dataDir),
    trustProxy: flag(env, 'TRUST_PROXY', false),
    registration: flag(env, 'REGISTRATION', true),
    localLogin: flag(env, 'LOCAL_LOGIN', true),
    oidc: issuer && clientId
      ? { issuer: issuer.replace(/\/+$/, ''), clientId, clientSecret: env.OIDC_CLIENT_SECRET || undefined, name: env.OIDC_NAME || 'OpenID Connect', registration: flag(env, 'OIDC_REGISTRATION', true) }
      : null,
    smtp: host && from
      ? { host, port: Number(env.SMTP_PORT || 587), user: env.SMTP_USER || undefined, password: env.SMTP_PASSWORD || undefined, from }
      : null,
  };
  if (!config.localLogin && !config.oidc) throw new Error('Če je LOCAL_LOGIN=false, mora biti nastavljen OIDC.');
  return config;
}
