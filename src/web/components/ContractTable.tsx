import { Link } from 'react-router';
import type { ContractView } from '../../shared/contracts.js';
import { deadline } from '../format.js';
import { Badge } from './ui.js';

export function ContractTable({ contracts }: { contracts: ContractView[] }) {
  return (
    <div className="list">
      <table className="table" role="table">
        <thead role="rowgroup"><tr role="row">
          {['Pogodba', 'Kategorija', 'Rok za ukrepanje', 'Status'].map((h) => <th key={h} role="columnheader" scope="col">{h}</th>)}
        </tr></thead>
        <tbody role="rowgroup">
          {contracts.map((c) => {
            const { date, note } = deadline(c);
            return (
              <tr key={c.id} role="row">
                <td role="cell" className="main"><Link className="title" to={`/pogodbe/${c.id}`}>{c.title}</Link><span className="sub">{c.party}</span></td>
                <td role="cell" data-label="Kategorija">{c.category}</td>
                <td role="cell" className="num" data-label="Rok za ukrepanje">{date}{note && <span className="sub">{note}</span>}</td>
                <td role="cell"><Badge status={c.status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
