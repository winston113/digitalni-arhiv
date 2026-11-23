import { Bell, FileText, LayoutDashboard, LogOut, Settings, UserCog } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../api.js';
import { useApp, type Children } from '../state.js';
import { Logo } from './Logo.js';
import { ThemeMenu } from './ThemeMenu.js';
import { Icon } from './ui.js';

function Brand({ className = 'brand' }: { className?: string }) {
  return (
    <Link className={className} to="/" aria-label="Digitalni arhiv pogodb, na začetno stran">
      <Logo /><span className="brand-name">Digitalni arhiv pogodb</span>
    </Link>
  );
}

function NavItems({ first }: { first: string }) {
  const { alerts, user } = useApp();
  return (
    <>
      <NavLink className="nav-item" to="/" end><Icon of={LayoutDashboard} />{first}</NavLink>
      <NavLink className="nav-item" to="/pogodbe"><Icon of={FileText} />Pogodbe</NavLink>
      <NavLink className="nav-item" to="/opozorila"><Icon of={Bell} />Opozorila{alerts > 0 && <span className="nav-count" aria-label={`Število opozoril: ${alerts}`}>{alerts}</span>}</NavLink>
      {user?.role === 'admin' && <NavLink className="nav-item" to="/skrbnistvo"><Icon of={Settings} />Skrbništvo</NavLink>}
    </>
  );
}

function useSignOut() {
  const { setUser, toast } = useApp();
  return async () => {
    try { await api.signOut(); setUser(null); } catch { toast('Odjava ni uspela. Poskusite znova.'); }
  };
}

function SignOutButton() {
  return <button type="button" className="btn btn-secondary" onClick={useSignOut()}><Icon of={LogOut} /><span className="btn-label">Odjava</span></button>;
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
        <nav className="nav nav-side" aria-label="Glavna navigacija"><Brand /><div className="nav-items"><NavItems first="Nadzorna plošča" /></div></nav>
        <div className="main">
          <header className="appbar">
            <Brand className="brand brand-app" />
            <div className="appbar-actions">
              <Link className="appbar-user" to="/racun" title="Moj račun">{user?.email}</Link>
              <Link className="btn btn-secondary btn-icon account-phone" to="/racun" aria-label="Moj račun"><Icon of={UserCog} /></Link>
              <ThemeMenu />
              <SignOutButton />
            </div>
          </header>
          <main className="content" ref={main} tabIndex={-1}><Outlet /></main>
        </div>
      </div>
      <div className="nav-bottom-wrap"><nav className={`nav nav-bottom${user?.role === 'admin' ? ' nav-bottom-4' : ''}`} aria-label="Glavna navigacija, telefon"><NavItems first="Pregled" /></nav></div>
    </>
  );
}

export function AuthShell({ title, text, signOut = false, children }: { title: string; text: string; signOut?: boolean } & Children) {
  return (
    <div className="auth-page">
      <header className="appbar"><Brand /><div className="appbar-actions"><ThemeMenu />{signOut && <SignOutButton />}</div></header>
      <main className="auth"><div className="auth-box">
        <div className="auth-head"><Logo large /><h1>{title}</h1><p className="muted">{text}</p></div>
        {children}
      </div></main>
    </div>
  );
}
