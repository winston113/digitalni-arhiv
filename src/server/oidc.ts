import { normalizeIssuer, type OidcCheck, type OidcInput, type OidcMethod, type OidcView } from '../shared/oidc.js';
import type { Config } from './config.js';
import type { Settings } from './settings.js';

export interface OidcConfig { name: string; issuer: string; clientId: string; method: OidcMethod; clientSecret?: string; scopes: string; registration: boolean }

type Stored = Omit<OidcInput, 'clientSecret'> & { clientSecret: string | null };

export const discoveryUrl = (issuer: string) => `${issuer}/.well-known/openid-configuration`;

// Ponudnik je nastavljen v okolju ali v skrbniškem delu; okolje ima prednost.
export class Oidc {
  constructor(private config: Config, private settings: Settings) {}

  get current(): OidcConfig | null {
    if (this.config.oidc) return this.config.oidc;
    const stored = this.settings.get<Stored>('oidc');
    if (!stored) return null;
    const clientSecret = stored.clientSecret === null ? undefined : this.settings.decrypt(stored.clientSecret) ?? undefined;
    if (stored.method !== 'none' && !clientSecret) return null;
    return { ...stored, clientSecret: stored.method === 'none' ? undefined : clientSecret };
  }

  get redirectUri(): string { return `${this.config.baseUrl}/api/auth/callback/oidc`; }

  view(): OidcView {
    const s = this.config.oidc ?? this.settings.get<Stored>('oidc');
    return {
      source: this.config.oidc ? 'env' : s ? 'panel' : 'none',
      settings: s && { name: s.name, issuer: s.issuer, clientId: s.clientId, method: s.method, scopes: s.scopes, registration: s.registration, hasSecret: Boolean(s.clientSecret) },
      redirectUri: this.redirectUri,
    };
  }

  // Vrne false, če način zahteva skrivnost, ta pa ni vnesena ali shranjena za istega ponudnika.
  save({ clientSecret, ...rest }: OidcInput): boolean {
    const old = this.settings.get<Stored>('oidc');
    const kept = old && old.issuer === rest.issuer && old.clientId === rest.clientId ? old.clientSecret : null;
    const secret = rest.method === 'none' ? null : clientSecret ? this.settings.encrypt(clientSecret) : kept;
    if (rest.method !== 'none' && secret === null) return false;
    this.settings.set('oidc', { ...rest, clientSecret: secret } satisfies Stored);
    return true;
  }

  clear(): void { this.settings.remove('oidc'); }
}

// Prebere konfiguracijo ponudnika. Vrne sporočilo, kadar naslov ni uporaben.
export async function checkIssuer(issuer: string): Promise<OidcCheck | string> {
  let body: Record<string, unknown>;
  try {
    const response = await fetch(discoveryUrl(issuer), { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (!response.ok) return 'Na tem naslovu ni konfiguracije OpenID Connect.';
    const text = await response.text();
    if (text.length > 200_000) return 'Na tem naslovu ni konfiguracije OpenID Connect.';
    body = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    return error instanceof SyntaxError ? 'Na tem naslovu ni konfiguracije OpenID Connect.' : 'Povezava s ponudnikom ni uspela. Preverite naslov.';
  }
  const list = (key: string) => (Array.isArray(body[key]) ? (body[key] as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  if (!['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'issuer'].every((k) => typeof body[k] === 'string')) {
    return 'Konfiguracija ponudnika ni popolna.';
  }
  if (normalizeIssuer(String(body.issuer)) !== issuer) return 'Ponudnik se predstavlja z drugim naslovom izdajatelja.';
  const pkce = list('code_challenge_methods_supported');
  return { issuer, pkce: pkce.includes('S256'), methods: list('token_endpoint_auth_methods_supported'), scopes: list('scopes_supported') };
}
