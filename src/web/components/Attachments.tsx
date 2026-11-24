import { Download, FileText, LoaderCircle, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_ATTACHMENTS, MAX_FILE_SIZE, type Attachment } from '../../shared/contracts.js';
import { api, ApiError } from '../api.js';
import { formatSize } from '../format.js';
import { msg, t, tr } from '../i18n.js';
import { useApp } from '../state.js';
import { TextStatus } from './TextStatus.js';
import { ConfirmDialog, ErrorNotice, Icon } from './ui.js';

export function Attachments({ contractId, attachments, onChange }: { contractId: string; attachments: Attachment[]; onChange: (a: Attachment[]) => void }) {
  const { user, toast, setUser } = useApp();
  const mayEdit = user!.permissions.edit;
  const picker = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ n: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const base = `/api/contracts/${contractId}/attachments`;

  // Datoteke se pošiljajo ena za drugo; napaka pri eni ne ustavi ostalih.
  const upload = async (files: File[]) => {
    const failed: string[] = [];
    let added = 0;
    setErrors([]);
    for (const [i, file] of files.entries()) {
      setProgress({ n: i + 1, total: files.length });
      const problem = !/\.pdf$/i.test(file.name) ? msg('Datoteka ni v obliki PDF. Izberite datoteko PDF.')
        : file.size > MAX_FILE_SIZE ? msg('Datoteka je prevelika. Izberite datoteko PDF, manjšo od 10 MB.') : null;
      if (problem) { failed.push(t('{name}: {error}', { name: file.name, error: t(problem) })); continue; }
      try {
        onChange(await api.addAttachment(contractId, file));
        added++;
      } catch (err) {
        const { message, status } = err as ApiError;
        if (status === 401) return setUser(null);
        failed.push(t('{name}: {error}', { name: file.name, error: tr(message) }));
      }
    }
    setProgress(null);
    setErrors(failed);
    if (added) toast(t('Priloge so dodane.'));
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('Priloge in aneksi')}</h2>
        {mayEdit && attachments.length < MAX_ATTACHMENTS && (
          <button type="button" className="btn btn-secondary" aria-busy={progress !== null} onClick={() => { if (!progress) picker.current?.click(); }}>
            <Icon of={progress ? LoaderCircle : Paperclip} />{t('Dodaj priloge')}
          </button>
        )}
        <input ref={picker} type="file" accept="application/pdf,.pdf" multiple hidden aria-label={t('Dodaj priloge')}
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void upload(files); }} />
      </div>
      <div className="panel-body stack">
        {progress && <p className="muted" role="status">{t('Nalaganje prilog: {n} od {total}', progress)}</p>}
        {errors.map((e) => <ErrorNotice key={e} message={e} />)}
        {attachments.length === 0 && !progress && <p className="muted">{t('Pogodba še nima prilog.')}</p>}
        {attachments.length > 0 && (
          <ul className="file-list">
            {attachments.map((a) => (
              <li key={a.id} className="file">
                <Icon of={FileText} />
                <div className="file-body"><a className="link file-name" href={`${base}/${a.id}/file`} target="_blank" rel="noreferrer">{a.name}</a><div className="file-meta num">{formatSize(a.size)}<TextStatus state={a.textState} /></div></div>
                <a className="btn btn-icon" href={`${base}/${a.id}/file?prenos`} download aria-label={t('Prenesi {name}', { name: a.name })}><Icon of={Download} /></a>
                {mayEdit && <button type="button" className="btn btn-icon btn-text-danger" aria-label={t('Izbriši {name}', { name: a.name })} onClick={() => setRemoving(a)}><Icon of={Trash2} /></button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {removing && (
        <ConfirmDialog title={t('Brisanje priloge')} label={t('Izbriši prilogo')} busyLabel={t('Brisanje')} close={() => setRemoving(null)}
          text={t('Priloga {name} bo trajno izbrisana.', { name: removing.name })}
          run={async () => { onChange(await api.removeAttachment(contractId, removing.id)); setRemoving(null); toast(t('Priloga je izbrisana.')); }} />
      )}
    </section>
  );
}
