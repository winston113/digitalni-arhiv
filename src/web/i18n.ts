import { toLang, tr as trIn, translate, type Key, type Lang, type Params } from '../shared/i18n.js';

// Jezik je skupen celotnemu vmesniku; ob spremembi App izriše vse znova.
let current: Lang = 'sl';
try { current = toLang(localStorage.getItem('jezik')); } catch { /* shramba ni na voljo */ }
document.documentElement.lang = current;

export const getLang = (): Lang => current;

export function storedLang(): Lang | null {
  try { return localStorage.getItem('jezik') ? toLang(localStorage.getItem('jezik')) : null; } catch { return null; }
}

export function applyLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
  try { localStorage.setItem('jezik', lang); } catch { /* shramba ni na voljo */ }
}

// t: znano besedilo. tr: besedilo, ki pride s strežnika ali iz stanja. msg: besedilo, ki se prevede ob izrisu.
export const t = (key: Key, params?: Params): string => translate(current, key, params);
export const tr = (text: string): string => trIn(current, text);
export const msg = (key: Key): Key => key;
