Gumb za izbiro svetle, temne ali sistemske teme.

- Je na vseh zaslonih na istem mestu, desno zgoraj, tudi pred prijavo.
- Privzeta izbira je Sistemska in sledi nastavitvi naprave, tudi če se ta spremeni med uporabo.
- Ikona gumba je trenutna izbira: `monitor`, `sun` ali `moon`; `aria-label` jo pove z besedo.
- Aplikacija izbiro shrani v brskalniku in na korenski element zapiše `data-theme="light"` ali `data-theme="dark"`, še preden se stran izriše.
- Puščični tipki premikata izbiro, Esc zapre meni in vrne fokus na gumb.
- Delovanje je v `components/bundle.js`: `DigitalniArhivPogodb.theme.bindThemeMenu(element)`. Postavka ima `data-choice` z vrednostjo `system`, `light` ali `dark`. Pred izrisom strani pokličite `theme.apply(theme.stored())`.
