import { z } from 'zod';

export const OIDC_METHODS = ['none', 'client_secret_basic', 'client_secret_post'] as const;
export type OidcMethod = (typeof OIDC_METHODS)[number];

const DISCOVERY = /\/\.well-known\/openid-configuration\/?$/;

// Sprejme naslov izdajatelja ali celoten naslov konfiguracije.
export const normalizeIssuer = (value: string) => value.trim().replace(DISCOVERY, '').replace(/\/+$/, '');

function allowedIssuer(value: string): boolean {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export const issuer = z.string({ error: 'Vnesite naslov ponudnika.' }).max(500, { error: 'Naslov je predolg.' }).transform(normalizeIssuer)
  .refine(allowedIssuer, { error: 'Vnesite naslov, ki se začne s https://.' });

export const oidcInput = z.object({
  name: z.string({ error: 'Vnesite ime ponudnika.' }).trim().min(1, { error: 'Vnesite ime ponudnika.' }).max(40, { error: 'Ime je predolgo. Največ 40 znakov.' }),
  issuer,
  clientId: z.string({ error: 'Vnesite ID odjemalca.' }).trim().min(1, { error: 'Vnesite ID odjemalca.' }).max(200, { error: 'ID odjemalca je predolg.' }),
  method: z.enum(OIDC_METHODS, { error: 'Izberite način overjanja.' }),
  // null: obdrži shranjeno skrivnost.
  clientSecret: z.string().max(500, { error: 'Skrivnost je predolga.' }).nullable(),
  scopes: z.string().trim().max(200, { error: 'Seznam obsegov je predolg.' }).regex(/^[\x21\x23-\x5b\x5d-\x7e ]*$/, { error: 'Obsege ločite s presledki.' })
    .transform((v) => [...new Set(['openid', ...v.split(/\s+/).filter(Boolean)])].join(' ')),
  registration: z.boolean(),
});
export type OidcInput = z.infer<typeof oidcInput>;

export interface OidcView {
  source: 'none' | 'env' | 'panel';
  settings: (Omit<OidcInput, 'clientSecret'> & { hasSecret: boolean }) | null;
  redirectUri: string;
}

export interface OidcCheck { issuer: string; pkce: boolean; methods: string[]; scopes: string[] }
