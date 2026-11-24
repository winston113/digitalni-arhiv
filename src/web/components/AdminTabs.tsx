import { NavLink } from 'react-router';
import { t } from '../i18n.js';

export function AdminTabs() {
  return (
    <nav className="tabs" aria-label={t('Skrbništvo')}>
      <NavLink to="/skrbnistvo/uporabniki">{t('Uporabniki')}</NavLink>
      <NavLink to="/skrbnistvo/posta">{t('E-pošta')}</NavLink>
      <NavLink to="/skrbnistvo/prijava">{t('Zunanja prijava')}</NavLink>
      <NavLink to="/skrbnistvo/ui">{t('Umetna inteligenca')}</NavLink>
    </nav>
  );
}
