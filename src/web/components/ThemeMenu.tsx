import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './ui.js';

type Choice = 'system' | 'light' | 'dark';
const OPTIONS: [Choice, string, LucideIcon][] = [['system', 'Sistemska', Monitor], ['light', 'Svetla', Sun], ['dark', 'Temna', Moon]];
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
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const index = OPTIONS.findIndex(([c]) => c === choice);
  const [, label, icon] = OPTIONS[index]!;

  useEffect(() => {
    apply(choice);
    const onChange = () => apply(choice);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]')[index]?.focus();
    const outside = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open, index]);

  const pick = (next: Choice) => {
    setChoice(next);
    try { localStorage.setItem('tema', next); } catch { /* shramba ni na voljo */ }
    setOpen(false);
    button.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { setOpen(false); button.current?.focus(); }
    if (e.key === 'Tab') setOpen(false);
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = [...wrap.current!.querySelectorAll<HTMLElement>('[role=menuitemradio]')];
    items[(items.indexOf(document.activeElement as HTMLElement) + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button ref={button} type="button" className="btn btn-secondary btn-icon" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Tema: ${label.toLowerCase()}`} onClick={() => setOpen(!open)}><Icon of={icon} /></button>
      {open && (
        <div className="menu" role="menu" aria-label="Tema">
          {OPTIONS.map(([value, name, glyph]) => (
            <button key={value} type="button" className="menu-item" role="menuitemradio" aria-checked={value === choice} tabIndex={-1} onClick={() => pick(value)}>
              <Icon of={glyph} />{name}<Check className="icon check-mark" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
