import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Mark } from '../../shared/ai.js';
import { t } from '../i18n.js';
import { ErrorNotice, Icon, Skeleton } from './ui.js';

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS = [1, 1.25, 1.5, 2, 3];
const MAX_PIXELS = 16_000_000;

export interface PreviewMark extends Mark { key: string; label: string }
// Kam naj se premakne pogled; n se poveča ob vsaki zahtevi, tudi za isto mesto.
export interface PreviewTarget { key: string; page: number; n: number }

// Predogled izbrane datoteke. Datoteka se nariše v brskalniku in se za to nikamor ne pošlje.
export default function PdfPreview({ file, marks, target, onPick }: { file: File; marks: PreviewMark[]; target: PreviewTarget | null; onPick: (key: string) => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let close: (() => void) | null = null;
    setDoc(null);
    setPages([]);
    setFailed(false);
    void (async () => {
      try {
        // Brez WebAssembly, da varnostna pravila strani (CSP) ostanejo nespremenjena.
        const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWasm: false, wasmUrl: '/pdfjs/', enableXfa: false, maxImageSize: 100_000_000 });
        close = () => { void task.destroy(); };
        if (!active) return close();
        const opened = await task.promise;
        // Mere vseh strani so potrebne, da je pomik do oznake natančen.
        const list: PDFPageProxy[] = [];
        for (let i = 1; i <= opened.numPages && active; i++) {
          list.push(await opened.getPage(i));
          if (i === 1 || i % 50 === 0 || i === opened.numPages) { if (active) { setDoc(opened); setPages([...list]); } }
        }
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; close?.(); };
  }, [file]);

  const ready = pages.length > 0;
  useEffect(() => {
    const box = scroller.current;
    if (!box || !ready || !target) return;
    const page = box.querySelector<HTMLElement>(`[data-page="${target.page}"]`);
    if (!page) return;
    const mark = marks.find((m) => m.key === target.key);
    const top = page.offsetTop + (mark ? mark.y * page.offsetHeight : 0);
    const left = mark ? page.offsetLeft + (mark.x + mark.w / 2) * page.offsetWidth - box.clientWidth / 2 : box.scrollLeft;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), left: Math.max(0, left), behavior: calm ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ready, zoom]);

  if (failed) return <ErrorNotice message={t('Predogleda te datoteke ni mogoče prikazati.')} />;
  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="muted num">{doc ? t('Strani: {n}', { n: doc.numPages }) : ''}</span>
        <button type="button" className="btn btn-icon" aria-label={t('Pomanjšaj')} disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}><Icon of={ZoomOut} /></button>
        <span className="num preview-zoom">{Math.round(ZOOMS[zoom]! * 100)} %</span>
        <button type="button" className="btn btn-icon" aria-label={t('Povečaj')} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}><Icon of={ZoomIn} /></button>
      </div>
      <div className="preview-pages" ref={scroller} tabIndex={0} role="region" aria-label={t('Predogled dokumenta {name}', { name: file.name })}>
        {!ready && <Skeleton label={t('Nalaganje predogleda')} />}
        {pages.map((page, i) => (
          <Page key={i} page={page} number={i + 1} zoom={ZOOMS[zoom]!} marks={marks.filter((m) => m.page === i + 1)} active={target?.key ?? null} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function Page({ page, number, zoom, marks, active, onPick }: { page: PDFPageProxy; number: number; zoom: number; marks: PreviewMark[]; active: string | null; onPick: (key: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const size = page.getViewport({ scale: 1 });

  useEffect(() => {
    const seen = new IntersectionObserver(([e]) => setNear(e!.isIntersecting), { root: box.current!.parentElement, rootMargin: '100% 0px' });
    const resized = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    seen.observe(box.current!);
    resized.observe(box.current!);
    return () => { seen.disconnect(); resized.disconnect(); };
  }, []);

  // Riše se samo, kar je blizu vidnega dela; slika se zamenja šele, ko je nova pripravljena.
  useEffect(() => {
    const holder = box.current!.firstElementChild!;
    if (!near || !width) { holder.replaceChildren(); return; }
    let task: RenderTask | null = null;
    const timer = setTimeout(() => {
      const ratio = Math.min(2, devicePixelRatio || 1);
      const wanted = (width * ratio) / size.width;
      const viewport = page.getViewport({ scale: Math.min(wanted, Math.sqrt(MAX_PIXELS / (size.width * size.height))) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      task.promise.then(() => holder.replaceChildren(canvas), () => {});
    }, 60);
    return () => { clearTimeout(timer); task?.cancel(); };
  }, [near, width, page, size.width, size.height]);

  return (
    <div className="preview-page" data-page={number} data-theme="light" ref={box} style={{ width: `${zoom * 100}%`, aspectRatio: `${size.width} / ${size.height}` }} role="img" aria-label={t('Stran {page}', { page: number })}>
      <div className="preview-canvas" />
      {marks.map((m, i) => (
        <span key={i} aria-hidden="true" title={m.label} className={`preview-mark${m.key === active ? ' is-active' : ''}`} onClick={() => onPick(m.key)}
          style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }} />
      ))}
    </div>
  );
}
