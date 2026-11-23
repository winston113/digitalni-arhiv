import { Link } from 'react-router';
import { Empty } from '../components/ui.js';
import { usePageTitle } from '../state.js';

export function NotFound({ title = 'Stran ne obstaja', text = 'Povezava je napačna ali pa do strani nimate dostopa.', to = '/pogodbe', label = 'Na seznam pogodb' }: { title?: string; text?: string; to?: string; label?: string }) {
  usePageTitle(title);
  return <Empty title={title} text={text}><Link className="btn btn-secondary" to={to}>{label}</Link></Empty>;
}
