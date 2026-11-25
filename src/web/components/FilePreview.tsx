import { lazy } from 'react';
import type { Mark } from '../../shared/ai.js';
import { fileKind } from '../../shared/files.js';

const PdfPreview = lazy(() => import('./PdfPreview.js'));
const DocxPreview = lazy(() => import('./DocxPreview.js'));

// Vir podatka: pri PDF so oznake izračunane na strežniku, pri DOCX predogled navedek poišče sam.
export interface PreviewSource { key: string; label: string; quote: string; marks: Mark[] }
// Kam naj se premakne pogled; n se poveča ob vsaki zahtevi, tudi za isto mesto.
export interface PreviewTarget { key: string; page: number; n: number }

export interface PreviewProps { file: File; sources: PreviewSource[]; target: PreviewTarget | null; onPick: (key: string) => void }

// Predogled datoteke. Nariše se v brskalniku in se za to nikamor ne pošlje.
export function FilePreview(props: PreviewProps) {
  return fileKind(props.file.name) === 'docx' ? <DocxPreview {...props} /> : <PdfPreview {...props} />;
}
