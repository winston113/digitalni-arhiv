import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export function Menu<T extends string>({ label, menuLabel, value, options, onPick, button, className, check }: {
  label: string; menuLabel: string; value: T; options: { value: T; content: ReactNode }[]; onPick: (value: T) => void; button: ReactNode; className: string; check: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = () => [...wrap.current!.querySelectorAll<HTMLElement>('[role=menuitemradio]')];

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[aria-checked=true]')?.focus();
    const outside = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    if (e.key === 'Tab') setOpen(false);
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const all = items();
    all[(all.indexOf(document.activeElement as HTMLElement) + step + all.length) % all.length]?.focus();
  };

  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button ref={trigger} type="button" className={className} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>{button}</button>
      {open && (
        <div className="menu" role="menu" aria-label={menuLabel}>
          {options.map((o) => (
            <button key={o.value} type="button" className="menu-item" role="menuitemradio" aria-checked={o.value === value} tabIndex={-1}
              onClick={() => { onPick(o.value); setOpen(false); trigger.current?.focus(); }}>{o.content}{check}</button>
          ))}
        </div>
      )}
    </div>
  );
}
