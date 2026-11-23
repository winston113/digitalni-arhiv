import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { SendMail } from './mail.js';
import { UserStore } from './users.js';

export const CLIENT_IP_HEADER = 'x-arhiv-client-ip';

export function createAuth(config: Config, db: Db, sendMail: SendMail | null) {
  const { oidc } = config;
  const users = new UserStore(db);
  return betterAuth({
    appName: 'Digitalni arhiv pogodb',
    baseURL: config.baseUrl,
    secret: config.secret,
    database: db,
    trustedOrigins: [config.baseUrl],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: config.localLogin,
      disableSignUp: !config.registration,
      minPasswordLength: 8,
      revokeSessionsOnPasswordReset: true,
      onPasswordReset: async ({ user }) => users.setMustChangePassword(user.id, false),
      ...(sendMail && {
        // Pošiljanja ne čakamo, da odzivni čas ne razkrije, ali račun obstaja.
        sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
          void sendMail(
            user.email,
            'Ponastavitev gesla',
            `Pozdravljeni,\n\nprejeli smo zahtevo za ponastavitev gesla v Digitalnem arhivu pogodb. Novo geslo nastavite na povezavi, ki velja eno uro:\n\n${url}\n\nČe zahteve niste poslali vi, sporočilo prezrite.\n`,
          ).catch((error) => console.error('Pošiljanje sporočila ni uspelo:', error));
        },
      }),
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
            discoveryUrl: `${oidc.issuer}/.well-known/openid-configuration`,
            clientId: oidc.clientId,
            clientSecret: oidc.clientSecret,
            scopes: ['openid', 'profile', 'email'],
            pkce: true,
            requireIdTokenVerification: true,
            // Prijava in registracija sta ločeni: nov račun nastane samo na izrecno zahtevo.
            disableImplicitSignUp: true,
            disableSignUp: !oidc.registration,
            ...(oidc.clientSecret ? {} : { tokenEndpointAuth: { method: 'none' as const } }),
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
