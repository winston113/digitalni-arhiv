import { Link } from 'react-router';
import { Empty } from '../components/ui.js';
import { usePageTitle } from '../state.js';

export function NotFound({ title = 'Stran ne obstaja', text = 'Povezava je napačna ali pa je bila stran odstranjena.' }: { title?: string; text?: string }) {
  usePageTitle(title);
  return <Empty title={title} text={text}><Link className="btn btn-secondary" to="/pogodbe">Na seznam pogodb</Link></Empty>;
}
