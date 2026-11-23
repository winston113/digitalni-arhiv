import { z } from 'zod';
import type { Lang } from './i18n.js';

export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

// Dovoljenja veljajo za uporabnikove lastne pogodbe; tujih ne vidi nihče, tudi skrbnik ne.
export const PERMISSIONS = ['create', 'edit', 'remove'] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Permissions = Record<Permission, boolean>;

export interface Access {
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  permissions: Permissions;
}

export interface Me extends Access {
  id: string;
  name: string;
  email: string;
  hasPassword: boolean;
  emailVerified: boolean;
  reminders: boolean;
  language: Lang;
}

export interface ManagedUser extends Me {
  hasOidc: boolean;
  contracts: number;
  createdAt: string;
}

const name = z.string({ error: 'Vnesite ime in priimek.' }).trim().min(1, { error: 'Vnesite ime in priimek.' }).max(100, { error: 'Ime je predolgo. Največ 100 znakov.' });
const permissions = z.object({ create: z.boolean(), edit: z.boolean(), remove: z.boolean() });

export const password = z.string({ error: 'Vnesite geslo.' })
  .min(8, { error: 'Geslo je prekratko. Vnesite najmanj 8 znakov.' })
  .max(128, { error: 'Geslo je predolgo. Vnesite največ 128 znakov.' });

export const userUpdate = z.object({
  name,
  role: z.enum(ROLES, { error: 'Izberite vlogo.' }),
  disabled: z.boolean(),
  permissions,
});

export const userCreate = z.object({
  name,
  email: z.string({ error: 'Vnesite veljaven e-poštni naslov.' }).trim().toLowerCase().pipe(z.email({ error: 'Vnesite veljaven e-poštni naslov.' })),
  password,
  mustChangePassword: z.boolean(),
  role: z.enum(ROLES, { error: 'Izberite vlogo.' }),
  permissions,
});

export const passwordReset = z.object({ password, mustChangePassword: z.boolean() });

export type UserUpdate = z.infer<typeof userUpdate>;
export type UserCreate = z.infer<typeof userCreate>;
