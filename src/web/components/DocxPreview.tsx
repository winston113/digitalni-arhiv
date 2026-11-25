import { renderAsync } from 'docx-preview';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n.js';
import type { PreviewSource, PreviewTarget } from './FilePreview.js';
import { ErrorNotice, Icon, Skeleton } from './ui.js';

const ZOOMS = [1, 1.25, 1.5, 2];
const bare = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

interface Box { key: string; label: string; x: number; y: number; w: number; h: number }

// Besedilo dokumenta brez ločil, z mestom vsakega znaka, da je navedek mogoče najti in označiti.
function indexText(root: HTMLElement): { text: string; at: [Text, number][] } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  const at: [Text, number][] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.closest('style')) continue;
    for (let i = 0; i < node.data.length; i++) {
      const part = bare(node.data[i]!);
      text += part;
      for (let k = 0; k < part.length; k++) at.push([node, i]);
    }
  }
  return { text, at };
}

function findRanges(index: ReturnType<typeof indexText>, quote: string): Range[] {
  const ranges: Range[] = [];
  for (const part of quote.split(/\.{3}|…/).map(bare).filter(Boolean)) {
    const start = index.text.indexOf(part);
    if (start < 0) return [];
    const [from, fromOffset] = index.at[start]!;
    const [to, toOffset] = index.at[start + part.length - 1]!;
    const range = from.ownerDocument.createRange();
    range.setStart(from, fromOffset);
    range.setEnd(to, toOffset + 1);
    ranges.push(range);
  }
  return ranges;
}

// Krepko in ležeče besedilo je v ločenih delih, zato se kosi iste vrstice združijo v eno oznako.
function lineBoxes(range: Range): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const r of [...range.getClientRects()].filter((b) => b.width > 1 && b.height > 1)) {
    const same = out.find((b) => Math.abs(b.y + b.h / 2 - (r.top + r.height / 2)) < Math.min(b.h, r.height) / 2 && r.left <= b.x + b.w + 12 && r.right >= b.x - 12);
    if (!same) { out.push({ x: r.left, y: r.top, w: r.width, h: r.height }); continue; }
    const right = Math.max(same.x + same.w, r.right);
    const bottom = Math.max(same.y + same.h, r.bottom);
    same.x = Math.min(same.x, r.left);
    same.y = Math.min(same.y, r.top);
    same.w = right - same.x;
    same.h = bottom - same.y;
  }
  return out;
}

// Predogled datoteke Word. Dokument je v ločenem okvirju brez skript, oznake pa so nad njim.
export default function DocxPreview({ file, sources, target, onPick }: { file: File; sources: PreviewSource[]; target: PreviewTarget | null; onPick: (key: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [zoom, setZoom] = useState(0);
  const scale = ZOOMS[zoom]!;

  useEffect(() => {
    let active = true;
    setBody(null);
    setFailed(false);
    const holder = document.createElement('div');
    const styles = document.createElement('div');
    renderAsync(file, holder, styles, {
      className: 'docx', inWrapper: false, ignoreWidth: true, ignoreHeight: true, ignoreFonts: true, breakPages: false, useBase64URL: true,
      renderAltChunks: false, renderComments: false, renderChanges: false, renderHeaders: true, renderFooters: true, experimental: false, debug: false,
    }).then(() => {
      const doc = frame.current?.contentDocument;
      if (!active || !doc) return;
      // Povezave, obrazci in vdelana vsebina iz tuje datoteke v predogledu nimajo kaj početi.
      holder.querySelectorAll('iframe, object, embed, script, form, link, base, meta').forEach((e) => e.remove());
      holder.querySelectorAll('[href]').forEach((e) => e.removeAttribute('href'));
      const base = doc.createElement('style');
      base.textContent = 'html,body{margin:0;background:#fff;color:#000;overflow:hidden}section.docx{box-sizing:border-box;max-width:100%;padding:32px!important;overflow-wrap:anywhere}img,svg,table{max-width:100%}';
      doc.head.replaceChildren(base, ...[...styles.childNodes].map((n) => doc.adoptNode(n)));
      doc.body.replaceChildren(...[...holder.childNodes].map((n) => doc.adoptNode(n)));
      setBody(doc.body);
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [file]);

  // Višina in oznake se preračunajo ob vsaki spremembi velikosti, na primer ko se naloži slika.
  useEffect(() => {
    if (!body) return;
    const index = indexText(body);
    const found = sources.flatMap((s) => findRanges(index, s.quote).map((range) => ({ s, range })));
    const measure = () => {
      setHeight(body.scrollHeight);
      setBoxes(found.flatMap(({ s, range }) => lineBoxes(range).map((b) => ({ ...b, key: s.key, label: s.label })))
        .sort((a, b) => b.w * b.h - a.w * a.h));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    measure();
    return () => observer.disconnect();
  }, [body, sources]);

  useEffect(() => {
    const box = scroller.current;
    const mark = target && boxes.find((b) => b.key === target.key);
    if (!box || !mark) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: Math.max(0, mark.y * scale - box.clientHeight / 3), left: Math.max(0, (mark.x + mark.w / 2) * scale - box.clientWidth / 2), behavior: calm ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, boxes.length, scale]);

  if (failed) return <ErrorNotice message={t('Predogleda te datoteke ni mogoče prikazati.')} />;
  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="muted">{t('Dokument Word')}</span>
        <button type="button" className="btn btn-icon" aria-label={t('Pomanjšaj')} disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}><Icon of={ZoomOut} /></button>
        <span className="num preview-zoom">{Math.round(scale * 100)} %</span>
        <button type="button" className="btn btn-icon" aria-label={t('Povečaj')} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}><Icon of={ZoomIn} /></button>
      </div>
      <div className="preview-pages" ref={scroller} tabIndex={0} role="region" aria-label={t('Predogled dokumenta {name}', { name: file.name })}>
        {!body && <Skeleton label={t('Nalaganje predogleda')} />}
        <div className="docx-size" hidden={!body} style={{ height: height * scale }}>
          <div className="docx-page" data-theme="light" style={{ height, transform: `scale(${scale})` }}>
            <iframe ref={frame} className="docx-frame" title={t('Predogled dokumenta {name}', { name: file.name })} sandbox="allow-same-origin" srcDoc="<!doctype html><html lang='sl'><head></head><body></body></html>" style={{ height }} tabIndex={-1} />
            {boxes.map((m, i) => (
              <span key={i} aria-hidden="true" title={m.label} className={`preview-mark${m.key === target?.key ? ' is-active' : ''}`} onClick={() => onPick(m.key)} style={{ left: m.x, top: m.y, width: m.w, height: m.h }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
