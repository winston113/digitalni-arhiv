import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Upload } from '../../shared/uploads.js';
import { api } from '../api.js';
import { Skeleton } from '../components/ui.js';
import { t } from '../i18n.js';
import { useApp } from '../state.js';
import { Form } from './ContractForm.js';
import { Reader } from '../reader.js';
import type { QueueItem, QueueOptions } from './queue.js';

const BatchFiles = lazy(() => import('./BatchFiles.js'));
const SplitFile = lazy(() => import('./SplitFile.js'));

// Vsaka izbrana datoteka se naloži največ enkrat, ne glede na to, kdo jo potrebuje prvi.
export function useUpload() {
  const cache = useRef<{ file: File; upload: Promise<Upload> } | null>(null);
  const ensure = (file: File, onProgress: (percent: number) => void): Promise<Upload> => {
    if (cache.current?.file !== file) {
      const upload = api.upload(file, onProgress);
      cache.current = { file, upload };
      upload.catch(() => { if (cache.current?.upload === upload) cache.current = null; });
    }
    return cache.current!.upload;
  };
  // Datoteka ne bo shranjena, zato naj ne čaka na strežniku. Po shranjevanju jo je treba samo pozabiti.
  const discard = () => { cache.current?.upload.then((u) => api.removeUpload(u.id)).catch(() => {}); cache.current = null; };
  const forget = () => { cache.current = null; };
  useEffect(() => () => { cache.current?.upload.then((u) => api.removeUpload(u.id)).catch(() => {}); cache.current = null; }, []);
  return { ensure, discard, forget };
}

type Stage = { kind: 'form'; file: File | null } | { kind: 'split'; file: File } | { kind: 'batch'; files: File[] } | { kind: 'queue'; items: QueueItem[]; index: number; saved: number; options: QueueOptions };

export function NewContract() {
  const { toast } = useApp();
  const navigate = useNavigate();
  const uploads = useUpload();
  const [stage, setStage] = useState<Stage>({ kind: 'form', file: null });

  const reader = useRef<Reader | null>(null);
  useEffect(() => () => reader.current?.stop(), []);
  const begin = (items: QueueItem[], options: QueueOptions) => {
    uploads.forget();
    if (options.auto) {
      const r = (reader.current = new Reader());
      // Napako pokaže obrazec, ko pride na vrsto.
      for (const { upload } of items) r.read(upload.id).catch(() => {});
    }
    setStage({ kind: 'queue', items, index: 0, saved: 0, options });
  };

  // Preostale pogodbe iz razdeljene datoteke bi se ob zaprtju strani izgubile.
  useEffect(() => {
    if (stage.kind !== 'queue') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [stage.kind]);

  if (stage.kind === 'split') {
    return (
      <Suspense fallback={<Skeleton label={t('Nalaganje')} />}>
        <SplitFile file={stage.file} ensureUpload={(onProgress) => uploads.ensure(stage.file, onProgress)} onBack={() => setStage({ kind: 'form', file: stage.file })}
          onDone={begin} />
      </Suspense>
    );
  }
  if (stage.kind === 'batch') return <Suspense fallback={<Skeleton label={t('Nalaganje')} />}><BatchFiles files={stage.files} onBack={() => setStage({ kind: 'form', file: null })} onDone={begin} /></Suspense>;
  if (stage.kind === 'queue') {
    const { items, index, saved, options } = stage;
    const go = (count: number) => {
      if (index + 1 < items.length) { scrollTo(0, 0); return setStage({ ...stage, index: index + 1, saved: count }); }
      if (count) toast(t('Shranjenih pogodb: {n}', { n: count }));
      navigate('/pogodbe', { replace: true });
    };
    const item = items[index]!;
    return (
      <Form key={item.upload.id} contract={null} uploads={uploads} item={item} reader={reader.current} defaults={options.defaults} step={{ n: index + 1, total: items.length }} onSaved={() => { reader.current?.skip(item.upload.id); go(saved + 1); }}
        onSkip={() => { reader.current?.skip(item.upload.id); for (const u of [item.upload, ...item.attachments]) api.removeUpload(u.id).catch(() => {}); go(saved); }} />
    );
  }
  return <Form key="nova" contract={null} uploads={uploads} initialFile={stage.file} onSplit={(file) => setStage({ kind: 'split', file })} onMany={(files) => { uploads.discard(); setStage({ kind: 'batch', files }); }} />;
}
