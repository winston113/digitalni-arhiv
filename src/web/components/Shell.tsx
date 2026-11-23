import { Bell, FileText, LayoutDashboard, LogOut, Settings, UserCog } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../api.js';
import { useApp, type Children } from '../state.js';
import { Logo } from './Logo.js';
import { LanguageMenu } from './LanguageMenu.js';
import { ThemeMenu } from './ThemeMenu.js';
import { Icon } from './ui.js';
import { t } from '../i18n.js';

function Brand({ className = 'brand' }: { className?: string }) {
  return (
    <Link className={className} to="/" aria-label={t('Digitalni arhiv pogodb, na začetno stran')}>
      <Logo /><span className="brand-name">{t('Digitalni arhiv pogodb')}</span>
    </Link>
  );
}

function NavItems({ first }: { first: string }) {
  const { alerts, user } = useApp();
  return (
    <>
      <NavLink className="nav-item" to="/" end><Icon of={LayoutDashboard} />{first}</NavLink>
      <NavLink className="nav-item" to="/pogodbe"><Icon of={FileText} />{t('Pogodbe')}</NavLink>
      <NavLink className="nav-item" to="/opozorila"><Icon of={Bell} />{t('Opozorila')}{alerts > 0 && <span className="nav-count" aria-label={t('Število opozoril: {n}', { n: alerts })}>{alerts}</span>}</NavLink>
      {user?.role === 'admin' && <NavLink className="nav-item" to="/skrbnistvo"><Icon of={Settings} />{t('Skrbništvo')}</NavLink>}
    </>
  );
}

function useSignOut() {
  const { setUser, toast } = useApp();
  return async () => {
    try { await api.signOut(); setUser(null); } catch { toast(t('Odjava ni uspela. Poskusite znova.')); }
  };
}

function SignOutButton() {
  return <button type="button" className="btn btn-secondary" onClick={useSignOut()}><Icon of={LogOut} /><span className="btn-label">{t('Odjava')}</span></button>;
}

export function Shell() {
  const { user, refreshAlerts } = useApp();
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    refreshAlerts();
    if (first.current) { first.current = false; return; }
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname, refreshAlerts]);

  return (
    <>
      <div className="layout">
        <nav className="nav nav-side" aria-label={t('Glavna navigacija')}><Brand /><div className="nav-items"><NavItems first={t('Nadzorna plošča')} /></div></nav>
        <div className="main">
          <header className="appbar">
            <Brand className="brand brand-app" />
            <div className="appbar-actions">
              <Link className="appbar-user" to="/racun" title={t('Moj račun')}>{user?.email}</Link>
              <Link className="btn btn-secondary btn-icon account-phone" to="/racun" aria-label={t('Moj račun')}><Icon of={UserCog} /></Link>
              <LanguageMenu /><ThemeMenu />
              <SignOutButton />
            </div>
          </header>
          <main className="content" ref={main} tabIndex={-1}><Outlet /></main>
        </div>
      </div>
      <div className="nav-bottom-wrap"><nav className={`nav nav-bottom${user?.role === 'admin' ? ' nav-bottom-4' : ''}`} aria-label={t('Glavna navigacija, telefon')}><NavItems first={t('Pregled')} /></nav></div>
    </>
  );
}

export function AuthShell({ title, text, signOut = false, children }: { title: string; text: string; signOut?: boolean } & Children) {
  return (
    <div className="auth-page">
      <header className="appbar"><Brand /><div className="appbar-actions"><LanguageMenu /><ThemeMenu />{signOut && <SignOutButton />}</div></header>
      <main className="auth"><div className="auth-box">
        <div className="auth-head"><Logo large /><h1>{title}</h1><p className="muted">{text}</p></div>
        {children}
      </div></main>
    </div>
  );
}
