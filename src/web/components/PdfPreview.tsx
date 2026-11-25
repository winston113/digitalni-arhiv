import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Mark } from '../../shared/ai.js';
import { t } from '../i18n.js';
import { PageImage, usePdf } from './pdf.js';
import { ErrorNotice, Icon, Skeleton } from './ui.js';

const ZOOMS = [1, 1.25, 1.5, 2, 3];

export interface PreviewMark extends Mark { key: string; label: string }
// Kam naj se premakne pogled; n se poveča ob vsaki zahtevi, tudi za isto mesto.
export interface PreviewTarget { key: string; page: number; n: number }

// Predogled datoteke. Nariše se v brskalniku in se za to nikamor ne pošlje.
export default function PdfPreview({ file, marks, target, onPick }: { file: File; marks: PreviewMark[]; target: PreviewTarget | null; onPick: (key: string) => void }) {
  const { pages, total, failed } = usePdf(file);
  const [zoom, setZoom] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  const ready = target ? pages.length >= target.page : pages.length > 0;
  useEffect(() => {
    const box = scroller.current;
    if (!box || !ready || !target) return;
    const page = box.querySelector<HTMLElement>(`[data-page="${target.page}"]`);
    if (!page) return;
    const mark = marks.find((m) => m.key === target.key);
    const top = page.offsetTop + (mark ? mark.y * page.offsetHeight - box.clientHeight / 3 : 0);
    const left = mark ? page.offsetLeft + (mark.x + mark.w / 2) * page.offsetWidth - box.clientWidth / 2 : box.scrollLeft;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: calm ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ready, zoom]);

  if (failed) return <ErrorNotice message={t('Predogleda te datoteke ni mogoče prikazati.')} />;
  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="muted num">{total ? t('Strani: {n}', { n: total }) : ''}</span>
        <button type="button" className="btn btn-icon" aria-label={t('Pomanjšaj')} disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}><Icon of={ZoomOut} /></button>
        <span className="num preview-zoom">{Math.round(ZOOMS[zoom]! * 100)} %</span>
        <button type="button" className="btn btn-icon" aria-label={t('Povečaj')} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}><Icon of={ZoomIn} /></button>
      </div>
      <div className="preview-pages" ref={scroller} tabIndex={0} role="region" aria-label={t('Predogled dokumenta {name}', { name: file.name })}>
        {pages.length === 0 && <Skeleton label={t('Nalaganje predogleda')} />}
        {pages.map((page, i) => (
          <Page key={i} page={page} number={i + 1} zoom={ZOOMS[zoom]!} marks={marks.filter((m) => m.page === i + 1)} active={target?.key ?? null} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function Page({ page, number, zoom, marks, active, onPick }: { page: PDFPageProxy; number: number; zoom: number; marks: PreviewMark[]; active: string | null; onPick: (key: string) => void }) {
  return (
    <div className="preview-page" data-page={number} data-theme="light" style={{ width: `${zoom * 100}%` }} role="img" aria-label={t('Stran {page}', { page: number })}>
      <PageImage page={page} root=".preview-pages" />
      {marks.map((m, i) => (
        <span key={i} aria-hidden="true" title={m.label} className={`preview-mark${m.key === active ? ' is-active' : ''}`} onClick={() => onPick(m.key)}
          style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }} />
      ))}
    </div>
  );
}
