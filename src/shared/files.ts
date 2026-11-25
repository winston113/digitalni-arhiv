// Vrsti datotek, ki ju arhiv hrani. Vrsta je vedno razvidna iz imena, ker strežnik končnico uskladi z vsebino.
export type FileKind = 'pdf' | 'docx';

export const fileKind = (name: string): FileKind => (/\.docx$/i.test(name) ? 'docx' : 'pdf');
export const isAllowedName = (name: string) => /\.(pdf|docx)$/i.test(name);
export const withoutExtension = (name: string) => name.replace(/\.(pdf|docx)$/i, '');

export const MIME: Record<FileKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
export const ACCEPT = `.pdf,.docx,${MIME.pdf},${MIME.docx}`;
