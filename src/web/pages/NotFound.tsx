import { Link } from 'react-router';
import { Empty } from '../components/ui.js';
import { usePageTitle } from '../state.js';
import { t } from '../i18n.js';

export function NotFound({ title = t('Stran ne obstaja'), text = t('Povezava je napačna ali pa do strani nimate dostopa.'), to = '/pogodbe', label = t('Na seznam pogodb') }: { title?: string; text?: string; to?: string; label?: string }) {
  usePageTitle(title);
  return <Empty title={title} text={text}><Link className="btn btn-secondary" to={to}>{label}</Link></Empty>;
}
