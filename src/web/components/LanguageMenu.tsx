import { Check, ChevronDown } from 'lucide-react';
import { useApp } from '../state.js';
import { LANGS, type Lang } from '../../shared/i18n.js';
import { t } from '../i18n.js';
import { Menu } from './Menu.js';
import { Icon } from './ui.js';

// Ime jezika je vedno v jeziku samem, da ga prepozna tudi tisti, ki trenutnega ne razume.
const NAMES: Record<Lang, string> = { sl: 'Slovenščina', en: 'English' };

export function LanguageMenu() {
  const { lang, setLang } = useApp();
  return (
    <Menu label={t('Jezik: {name}', { name: NAMES[lang] })} menuLabel={t('Jezik')} value={lang} onPick={setLang} className="btn btn-secondary btn-lang"
      options={LANGS.map((value) => ({ value, content: <span lang={value}>{NAMES[value]}</span> }))}
      button={<>{lang.toUpperCase()}<Icon of={ChevronDown} size="sm" /></>} check={<Check className="icon check-mark" aria-hidden="true" />} />
  );
}
