import { GlobalWorkerOptions, getDocument, type PDFPageProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PIXELS = 16_000_000;

// Odpre datoteko v brskalniku; strani prihajajo postopoma, da se dolga datoteka pokaže takoj.
export function usePdf(file: File): { pages: PDFPageProxy[]; total: number; failed: boolean } {
  const [state, setState] = useState<{ pages: PDFPageProxy[]; total: number; failed: boolean }>({ pages: [], total: 0, failed: false });
  useEffect(() => {
    let active = true;
    let close: (() => void) | null = null;
    setState({ pages: [], total: 0, failed: false });
    void (async () => {
      try {
        // Brez WebAssembly, da varnostna pravila strani (CSP) ostanejo nespremenjena.
        const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWasm: false, wasmUrl: '/pdfjs/', enableXfa: false, maxImageSize: 100_000_000 });
        close = () => { void task.destroy(); };
        if (!active) return close();
        const opened = await task.promise;
        const list: PDFPageProxy[] = [];
        for (let i = 1; i <= opened.numPages && active; i++) {
          list.push(await opened.getPage(i));
          if (active && (i === 1 || i % 50 === 0 || i === opened.numPages)) setState({ pages: [...list], total: opened.numPages, failed: false });
        }
      } catch {
        if (active) setState({ pages: [], total: 0, failed: true });
      }
    })();
    return () => { active = false; close?.(); };
  }, [file]);
  return state;
}

// Slika ene strani. Riše se samo, kar je blizu vidnega dela; slika se zamenja šele, ko je nova pripravljena.
export function PageImage({ page, root }: { page: PDFPageProxy; root: string | null }) {
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const size = page.getViewport({ scale: 1 });

  useEffect(() => {
    const box = holder.current!;
    const seen = new IntersectionObserver(([e]) => setNear(e!.isIntersecting), { root: root ? box.closest(root) : null, rootMargin: '100% 0px' });
    const resized = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    seen.observe(box);
    resized.observe(box);
    return () => { seen.disconnect(); resized.disconnect(); };
  }, [root]);

  useEffect(() => {
    const box = holder.current!;
    if (!near || !width) { box.replaceChildren(); return; }
    let task: RenderTask | null = null;
    const timer = setTimeout(() => {
      const ratio = Math.min(2, devicePixelRatio || 1);
      const wanted = (width * ratio) / size.width;
      const viewport = page.getViewport({ scale: Math.min(wanted, Math.sqrt(MAX_PIXELS / (size.width * size.height))) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      task.promise.then(() => box.replaceChildren(canvas), () => {});
    }, 60);
    return () => { clearTimeout(timer); task?.cancel(); };
  }, [near, width, page, size.width, size.height]);

  return <div className="preview-canvas" ref={holder} style={{ aspectRatio: `${size.width} / ${size.height}` }} />;
}
