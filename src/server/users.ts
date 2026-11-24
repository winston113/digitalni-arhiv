import { toLang, type Lang } from '../shared/i18n.js';
import type { Access, ManagedUser, UserUpdate } from '../shared/users.js';
import type { Db } from './db.js';

interface AccessRow { role: string; disabled: number; can_create: number; can_edit: number; can_remove: number; can_use_ai: number; must_change_password: number; reminders: number; language: string }
interface UserRow extends AccessRow { id: string; name: string; email: string; createdAt: string | number; emailVerified: number; has_password: number; has_oidc: number; contracts: number }

const toAccess = (r: AccessRow): Access => ({
  role: r.role === 'admin' ? 'admin' : 'user',
  disabled: r.disabled !== 0,
  mustChangePassword: r.must_change_password !== 0,
  permissions: { create: r.can_create !== 0, edit: r.can_edit !== 0, remove: r.can_remove !== 0, ai: r.can_use_ai !== 0 },
});

const USERS = `SELECT u.id, u.name, u.email, u.createdAt, u.emailVerified, a.*,
  EXISTS (SELECT 1 FROM account x WHERE x.userId = u.id AND x.providerId = 'credential') AS has_password,
  EXISTS (SELECT 1 FROM account x WHERE x.userId = u.id AND x.providerId = 'oidc') AS has_oidc,
  (SELECT COUNT(*) FROM contracts c WHERE c.user_id = u.id) AS contracts
  FROM user u JOIN user_access a ON a.user_id = u.id`;

const toUser = (r: UserRow): ManagedUser => ({
  id: r.id, name: r.name, email: r.email, createdAt: new Date(r.createdAt).toISOString(),
  hasPassword: r.has_password !== 0, hasOidc: r.has_oidc !== 0, contracts: r.contracts, emailVerified: r.emailVerified !== 0, reminders: r.reminders !== 0, language: toLang(r.language), ...toAccess(r),
});

// Vloge in dovoljenja so ločeni od računov, zato jih registracija ne more nastaviti.
export class UserStore {
  constructor(private db: Db) {}

  // Prvi ustvarjeni uporabnik postane skrbnik. Sprožilec teče znotraj vstavljanja, zato sočasni registraciji ne moreta dobiti obe.
  ensureTrigger(): void {
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS user_access_insert AFTER INSERT ON user BEGIN
      INSERT INTO user_access (user_id, role) VALUES (NEW.id, CASE WHEN (SELECT COUNT(*) FROM user) = 1 THEN 'admin' ELSE 'user' END);
    END`);
  }

  access(id: string): Access | null {
    const row = this.db.prepare('SELECT * FROM user_access WHERE user_id = ?').get(id) as AccessRow | undefined;
    return row ? toAccess(row) : null;
  }

  isDisabled(id: string): boolean { return this.access(id)?.disabled ?? true; }

  list(): ManagedUser[] {
    return (this.db.prepare(USERS).all() as UserRow[]).map(toUser).sort((a, b) => a.name.localeCompare(b.name, 'sl'));
  }

  get(id: string): ManagedUser | null {
    const row = this.db.prepare(`${USERS} WHERE u.id = ?`).get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  isLastAdmin(id: string): boolean {
    const others = this.db.prepare("SELECT COUNT(*) AS n FROM user_access WHERE role = 'admin' AND disabled = 0 AND user_id <> ?").get(id) as { n: number };
    return others.n === 0;
  }

  update(id: string, input: Omit<UserUpdate, 'name'> & { name?: string }): void {
    this.db.transaction(() => {
      if (input.name) this.db.prepare('UPDATE user SET name = ? WHERE id = ?').run(input.name, id);
      const p = input.permissions;
      this.db.prepare('UPDATE user_access SET role = ?, disabled = ?, can_create = ?, can_edit = ?, can_remove = ?, can_use_ai = ? WHERE user_id = ?')
        .run(input.role, +input.disabled, +p.create, +p.edit, +p.remove, +p.ai, id);
      if (input.disabled) this.endSessions(id);
    })();
  }

  setMustChangePassword(id: string, value: boolean): void {
    this.db.prepare('UPDATE user_access SET must_change_password = ? WHERE user_id = ?').run(+value, id);
  }

  setReminders(id: string, value: boolean): void {
    this.db.prepare('UPDATE user_access SET reminders = ? WHERE user_id = ?').run(+value, id);
  }

  language(id: string): Lang {
    const row = this.db.prepare('SELECT language FROM user_access WHERE user_id = ?').get(id) as { language: string } | undefined;
    return toLang(row?.language);
  }

  setLanguage(id: string, value: Lang): void {
    this.db.prepare('UPDATE user_access SET language = ? WHERE user_id = ?').run(value, id);
  }

  endSessions(id: string): void { this.db.prepare('DELETE FROM session WHERE userId = ?').run(id); }

  // Seje, prijave in dovoljenja se izbrišejo kaskadno.
  remove(id: string): void { this.db.prepare('DELETE FROM user WHERE id = ?').run(id); }
}
