import type { Key } from '../../shared/i18n.js';
import type { TextState } from '../../shared/search.js';
import { t } from '../i18n.js';

const LABELS: Partial<Record<TextState, Key>> = {
  pending: 'besedilo se pripravlja',
  ocr: 'besedilo prepoznano s slike',
  empty: 'brez besedila',
  failed: 'besedila ni bilo mogoče prebrati',
};

// Običajnega stanja (besedilo je na voljo) ne izpisujemo.
export function TextStatus({ state }: { state: TextState }) {
  const label = LABELS[state];
  return label ? <>, {t(label)}</> : null;
}
