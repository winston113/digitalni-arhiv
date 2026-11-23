import { NavLink } from 'react-router';

export function AdminTabs() {
  return (
    <nav className="tabs" aria-label="Skrbništvo">
      <NavLink to="/skrbnistvo/uporabniki">Uporabniki</NavLink>
      <NavLink to="/skrbnistvo/posta">E-pošta</NavLink>
      <NavLink to="/skrbnistvo/prijava">Zunanja prijava</NavLink>
    </nav>
  );
}
