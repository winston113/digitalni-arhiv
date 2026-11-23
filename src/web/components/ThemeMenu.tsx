import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Key } from '../../shared/i18n.js';
import { t } from '../i18n.js';
import { Menu } from './Menu.js';
import { Icon } from './ui.js';

type Choice = 'system' | 'light' | 'dark';
const OPTIONS: [Choice, Key, LucideIcon][] = [['system', 'Sistemska', Monitor], ['light', 'Svetla', Sun], ['dark', 'Temna', Moon]];
const media = window.matchMedia('(prefers-color-scheme: dark)');

function stored(): Choice {
  try {
    const value = localStorage.getItem('tema');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}
function apply(choice: Choice) {
  const dark = choice === 'dark' || (choice === 'system' && media.matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function ThemeMenu() {
  const [choice, setChoice] = useState<Choice>(stored);
  const [, name, icon] = OPTIONS.find(([c]) => c === choice)!;

  useEffect(() => {
    apply(choice);
    const onChange = () => apply(choice);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);

  const pick = (next: Choice) => {
    setChoice(next);
    try { localStorage.setItem('tema', next); } catch { /* shramba ni na voljo */ }
  };
  return (
    <Menu label={t('Tema: {name}', { name: t(name).toLowerCase() })} menuLabel={t('Tema')} value={choice} onPick={pick} className="btn btn-secondary btn-icon"
      options={OPTIONS.map(([value, label, glyph]) => ({ value, content: <><Icon of={glyph} />{t(label)}</> }))}
      button={<Icon of={icon} />} check={<Check className="icon check-mark" aria-hidden="true" />} />
  );
}
