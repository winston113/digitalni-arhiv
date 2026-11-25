import { msg } from './i18n.js';
import type { AiConnection, AiInput, AiView, SuggestResult } from '../shared/ai.js';
import type { Attachment, ContractDetails, ContractView } from '../shared/contracts.js';
import type { MailInput, MailUses, MailView } from '../shared/mail.js';
import type { Key, Lang } from '../shared/i18n.js';
import type { OidcCheck, OidcInput, OidcView } from '../shared/oidc.js';
import type { SearchInput, SearchResult } from '../shared/search.js';
import type { CurrentUser, ManagedUser, UserCreate, UserUpdate } from '../shared/users.js';

export interface AppConfig {
  registration: { local: boolean; oidc: boolean };
  passwordReset: boolean;
  reminders: boolean;
  oidc: { name: string } | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly fields: Record<string, string> = {}, readonly detail = '') { super(message); }
}

const OFFLINE: Key = 'Povezava s strežnikom ni uspela. Preverite povezavo in poskusite znova.';

const AUTH_MESSAGES: Record<string, Key> = {
  INVALID_EMAIL_OR_PASSWORD: 'Napačna e-pošta ali geslo.',
  INVALID_EMAIL: 'Vnesite veljaven e-poštni naslov.',
  PASSWORD_TOO_SHORT: 'Geslo je prekratko. Vnesite najmanj 8 znakov.',
  PASSWORD_TOO_LONG: 'Geslo je predolgo. Vnesite največ 128 znakov.',
  USER_ALREADY_EXISTS: 'Račun s to e-pošto že obstaja. Prijavite se ali uporabite drug naslov.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Račun s to e-pošto že obstaja. Prijavite se ali uporabite drug naslov.',
  ACCOUNT_DISABLED: 'Račun je blokiran. Obrnite se na skrbnika.',
  INVALID_TOKEN: 'Povezava je potekla ali je že bila uporabljena. Zahtevajte novo.',
};

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(OFFLINE, 0);
  }
  if (response.ok) return response;
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string; fields?: Record<string, string>; detail?: string };
  if (response.status === 429) throw new ApiError(msg('Preveč poskusov. Počakajte minuto in poskusite znova.'), 429);
  const message = body.error ?? AUTH_MESSAGES[body.code ?? ''] ?? msg('Dejanje ni uspelo. Poskusite znova.');
  throw new ApiError(message, response.status, body.fields, body.detail);
}

const withBody = (method: string) => (path: string, body: unknown) =>
  send(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const post = withBody('POST');
const put = withBody('PUT');

function formData(data: unknown, file: File | null): FormData {
  const form = new FormData();
  form.set('data', JSON.stringify(data));
  if (file) form.set('file', file);
  return form;
}

export const api = {
  config: async () => (await send('/api/config')).json() as Promise<AppConfig>,
  me: async () => (await send('/api/me')).json() as Promise<CurrentUser | null>,
  signIn: (email: string, password: string) => post('/api/auth/sign-in/email', { email, password }),
  signUp: (name: string, email: string, password: string) => post('/api/auth/sign-up/email', { name, email, password }),
  signOut: () => post('/api/auth/sign-out', {}),
  requestReset: (email: string) => post('/api/auth/request-password-reset', { email, redirectTo: '/novo-geslo' }),
  resetPassword: (token: string, newPassword: string) => post('/api/auth/reset-password', { token, newPassword }),
  signInOidc: async (requestSignUp: boolean) => {
    const r = await post('/api/auth/sign-in/social', { provider: 'oidc', callbackURL: '/', errorCallbackURL: requestSignUp ? '/registracija' : '/prijava', requestSignUp });
    window.location.assign(((await r.json()) as { url: string }).url);
  },
  list: async () => (await send('/api/contracts')).json() as Promise<ContractView[]>,
  get: async (id: string) => (await send(`/api/contracts/${id}`)).json() as Promise<ContractDetails>,
  file: async (id: string, name: string) => new File([await (await send(`/api/contracts/${id}/file`)).blob()], name, { type: 'application/pdf' }),
  create: async (data: unknown, file: File | null) =>
    (await send('/api/contracts', { method: 'POST', body: formData(data, file) })).json() as Promise<ContractDetails>,
  update: async (id: string, data: unknown, file: File | null) =>
    (await send(`/api/contracts/${id}`, { method: 'PUT', body: formData(data, file) })).json() as Promise<ContractDetails>,
  extend: async (id: string, endDate: string) => (await post(`/api/contracts/${id}/extend`, { endDate })).json() as Promise<ContractDetails>,
  terminate: async (id: string) => (await post(`/api/contracts/${id}/terminate`, {})).json() as Promise<ContractDetails>,
  remove: (id: string) => send(`/api/contracts/${id}`, { method: 'DELETE' }),
  addAttachment: async (id: string, file: File) => (await send(`/api/contracts/${id}/attachments`, { method: 'POST', body: formData(null, file) })).json() as Promise<Attachment[]>,
  removeAttachment: async (id: string, attachment: string) => (await withBody('DELETE')(`/api/contracts/${id}/attachments/${attachment}`, {})).json() as Promise<Attachment[]>,
  search: async (data: SearchInput) => (await post('/api/search', data)).json() as Promise<SearchResult>,
  reindex: async (id: string) => (await post(`/api/contracts/${id}/reindex`, {})).json() as Promise<ContractDetails>,
  changePassword: (currentPassword: string, newPassword: string) => post('/api/password', { currentPassword, newPassword }),
  users: async () => (await send('/api/admin/users')).json() as Promise<ManagedUser[]>,
  user: async (id: string) => (await send(`/api/admin/users/${id}`)).json() as Promise<ManagedUser>,
  createUser: async (data: UserCreate) => (await post('/api/admin/users', data)).json() as Promise<ManagedUser>,
  updateUser: async (id: string, data: UserUpdate) => (await put(`/api/admin/users/${id}`, data)).json() as Promise<ManagedUser>,
  setUserPassword: async (id: string, data: { password: string; mustChangePassword: boolean }) => (await post(`/api/admin/users/${id}/password`, data)).json() as Promise<ManagedUser>,
  sendResetLink: (id: string) => post(`/api/admin/users/${id}/reset-link`, {}),
  sendVerification: (email: string) => post('/api/auth/send-verification-email', { email, callbackURL: '/racun?potrjeno=1' }),
  setReminders: (enabled: boolean) => put('/api/me/reminders', { enabled }),
  mail: async () => (await send('/api/admin/mail')).json() as Promise<MailView>,
  saveMail: async (data: MailInput) => (await put('/api/admin/mail', data)).json() as Promise<MailView>,
  clearMail: async () => (await withBody('DELETE')('/api/admin/mail', {})).json() as Promise<MailView>,
  saveMailUses: async (data: MailUses) => (await put('/api/admin/mail/uses', data)).json() as Promise<MailView>,
  testMail: async () => (await post('/api/admin/mail/test', {})).json() as Promise<{ to: string }>,
  runReminders: async () => (await post('/api/admin/mail/reminders', {})).json() as Promise<{ sent: number; failed: number }>,
  saveOidc: async (data: OidcInput) => (await put('/api/admin/oidc', data)).json() as Promise<OidcView>,
  clearOidc: async () => (await withBody('DELETE')('/api/admin/oidc', {})).json() as Promise<OidcView>,
  checkOidc: async (issuer: string) => (await post('/api/admin/oidc/check', { issuer })).json() as Promise<OidcCheck>,
  ai: async () => (await send('/api/admin/ai')).json() as Promise<AiView>,
  saveAi: async (data: AiInput) => (await put('/api/admin/ai', data)).json() as Promise<AiView>,
  clearAi: async () => (await withBody('DELETE')('/api/admin/ai', {})).json() as Promise<AiView>,
  aiModels: async (data: AiConnection) => (await post('/api/admin/ai/models', data)).json() as Promise<string[]>,
  suggest: async (file: File, signal: AbortSignal) => (await send('/api/suggestions', { method: 'POST', body: formData(null, file), signal })).json() as Promise<SuggestResult>,
  setLanguage: (language: Lang) => put('/api/me/language', { language }),
  firstPassword: (newPassword: string) => post('/api/password/first', { newPassword }),
  oidc: async () => (await send('/api/admin/oidc')).json() as Promise<OidcView>,
  removeUser: (id: string) => send(`/api/admin/users/${id}`, { method: 'DELETE' }),
};
