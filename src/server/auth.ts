import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { translate } from '../shared/i18n.js';
import type { Mail } from './mail.js';
import { discoveryUrl, type OidcConfig } from './oidc.js';
import { UserStore } from './users.js';

export const CLIENT_IP_HEADER = 'x-arhiv-client-ip';

export function createAuth(config: Config, db: Db, mail: Mail, oidc: OidcConfig | null) {
  const users = new UserStore(db);
  return betterAuth({
    appName: 'Digitalni arhiv pogodb',
    baseURL: config.baseUrl,
    secret: config.secret,
    database: db,
    trustedOrigins: [config.baseUrl],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.registration,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => users.setMustChangePassword(user.id, false),
      sendResetPassword: async ({ user, url }) => {
        if (!mail.canReset) return;
        mail.sendLater({
          to: user.email,
          subject: translate(users.language(user.id), 'Ponastavitev gesla'),
          text: translate(users.language(user.id), 'Pozdravljeni,\n\nprejeli smo zahtevo za ponastavitev gesla v Digitalnem arhivu pogodb. Novo geslo nastavite na povezavi, ki velja eno uro:\n\n{url}\n\nČe zahteve niste poslali vi, sporočilo prezrite.\n', { url }),
        });
      },
    },
    emailVerification: {
      expiresIn: 60 * 60,
      sendOnSignUp: false,
      sendOnSignIn: false,
      sendVerificationEmail: async ({ user, url }) => {
        if (!mail.ready) return;
        mail.sendLater({
          to: user.email,
          subject: translate(users.language(user.id), 'Potrditev e-poštnega naslova'),
          text: translate(users.language(user.id), 'Pozdravljeni,\n\nza prejemanje opozoril iz Digitalnega arhiva pogodb potrdite svoj naslov na povezavi, ki velja eno uro:\n\n{url}\n\nČe tega niste zahtevali, sporočilo prezrite in povezave ne odpirajte.\n', { url }),
        });
      },
    },
    account: {
      // Računi se nikoli ne povežejo samodejno, da tuj vnaprej ustvarjen račun ne more prevzeti prijave prek ponudnika.
      accountLinking: { disableImplicitLinking: true },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (users.isDisabled(session.userId)) throw new APIError('FORBIDDEN', { code: 'ACCOUNT_DISABLED', message: 'Account disabled' });
          },
        },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-in/social': { window: 60, max: 20 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 2 },
        '/reset-password': { window: 60, max: 5 },
        '/change-password': { window: 60, max: 5 },
        '/get-session': false,
      },
    },
    advanced: {
      cookiePrefix: 'arhiv',
      useSecureCookies: config.baseUrl.startsWith('https://'),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    plugins: oidc
      ? [genericOAuth({
          config: [{
            providerId: 'oidc',
            name: oidc.name,
            discoveryUrl: discoveryUrl(oidc.issuer),
            clientId: oidc.clientId,
            clientSecret: oidc.clientSecret,
            scopes: oidc.scopes.split(' '),
            pkce: true,
            requireIdTokenVerification: true,
            // Prijava in registracija sta ločeni: nov račun nastane samo na izrecno zahtevo.
            disableImplicitSignUp: true,
            disableSignUp: !oidc.registration,
            tokenEndpointAuth: { method: oidc.method },
          }],
        })]
      : [],
  });
}

export type Auth = ReturnType<typeof createAuth>;

export async function migrateAuth(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}

// Nastavitve ponudnika se lahko spremenijo med delovanjem, zato je prijava zamenljiva.
export class AuthHolder {
  current: Auth;

  constructor(private build: () => Auth) { this.current = build(); }

  rebuild(): void { this.current = this.build(); }
}
