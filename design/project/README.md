Pogodbe na enem mestu, roki pod nadzorom. Digitalni arhiv pogodb je poslovno orodje za osebo, ki v manjšem podjetju skrbi za pogodbe. Vmesnik je miren, jasen in enak na vseh zaslonih.

## Besedila

- Jezik je slovenščina, uporabnika vikamo. Angleških izrazov in nadomestnih besedil ni.
- Ton je stvaren: »Pogodba je shranjena.«, ne »Super, uspelo je!«. Klicajev in emojijev ni.
- Gumb pove dejanje: »Shrani pogodbo«, »Podaljšaj pogodbo«, »Počisti filtre«.
- Napaka pove vzrok in rešitev: »Datoteka je prevelika. Izberite manjšo.«
- Samo prva beseda naslova ima veliko začetnico.
- Datum: `15. 1. 2027` z nedeljivimi presledki. Znesek: `1.250,00 €`. Število se sklanja: 1 dan, 2 dneva, 3 dni, 23 dni.
- Statusov je pet: Aktivna, Kmalu poteče, Potekla, Še ni v veljavi, Prekinjena.

## Barve

- Edina primarna barva je `primary`. Uporabite jo za glavno dejanje, povezave in fokus, ne za okras. Navigacija ima svoje žetone `nav`, `nav-active`, `on-nav` in `on-nav-muted`.
- Stran je na `canvas`, vsebina na `surface`, besedilo v `ink`, pomožno besedilo v `ink-muted`.
- `warning` in `danger` pomenita samo status ali napako. Barva nikoli ni edini nosilec pomena; ob njej sta ikona in beseda.
- Obrobe plošč so `line`, obrobe vnosnih polj `line-strong`.
- Prelivov ni.
- Temi sta dve, svetla in temna, izbira pa ima tri možnosti: Sistemska (privzeto), Svetla, Temna. Uporabljajte žetone, nikoli neposrednih barv.

## Tipografija

Ena pisava: IBM Plex Sans v debelinah 400, 500 in 600. Naslov strani je `page-title`, naslov plošče `section-title`, besedilo `body`, oznake `label`, pomožno besedilo `small`. Besedilo ni nikoli manjše od 14 px. Številke v seznamih so tabelarične (`num`).

## Razmiki in oblika

- Uporabljajte samo korake od `space-1` do `space-7`.
- `radius-sm` imajo kontrole in oznake, `radius-md` plošče in okna. Drugih zaobljenosti ni.
- Ploskve ločujejo obrobe. `shadow-overlay` ima samo to, kar lebdi nad stranjo.
- Kontrole so visoke `control-height` (44 px), zato so primerne tudi za dotik.

## Postavitev

Na vrhu vsakega zaslona je Glava s preklopom teme desno. Znak in ime sta povsod ena povezava na začetno stran. Od 900 px širine je levo `sidebar-width`, desno vsebina do `content-width` z robom `space-6`. Pod 900 px je navigacija spodaj, rob vsebine je `space-4`, vsebina v enem stolpcu. Obrazci so široki največ `form-width`.

## Stanja in dostopnost

- Vsak zaslon ima oblikovano nalaganje, prazno stanje in napako.
- Brisanje in prekinitev zahtevata potrditev v pogovornem oknu.
- Fokus je 2 px obroba v `primary`, na zeleni podlagi v `on-nav`.
- Besedilo ima kontrast najmanj 4,5 : 1, obrobe kontrol in ikone najmanj 3 : 1.

## Ikone in znak

Ikone so iz nabora Lucide, glejte komponento Ikone. Znak je zajec, ki drži list pogodbe, glejte komponento Znak. Ob njem je ime v `section-title`.
