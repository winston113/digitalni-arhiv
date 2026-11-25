# Opis procesa

## Problem

Manjše podjetje ima sklenjenih več deset pogodb: najemne, dobavne, storitvene, zavarovalne, naročniške. Hranijo se na različnih mestih, pregled nad roki pa je odvisen od spomina posameznika ali ročno vodene preglednice.

Posledice:

- pogodba se samodejno podaljša, ker je bil odpovedni rok spregledan,
- pogodba poteče, storitev pa se izvaja naprej brez pravne podlage,
- iskanje posamezne pogodbe vzame preveč časa,
- vodstvo nima pregleda nad veljavnimi obveznostmi.

## Uporabnik

Oseba, ki v manjšem podjetju skrbi za pogodbe: vodja pisarne, računovodja ali direktor. Nima pravnega ali tehničnega znanja in potrebuje preprosto orodje. Vsak uporabnik vidi samo svoje pogodbe.

## Potek

| Korak | Danes | Z aplikacijo |
|---|---|---|
| 1. Nalaganje | Pogodba ostane v e-pošti ali mapi | Uporabnik naloži PDF v arhiv |
| 2. Razvrščanje | Ni enotnega sistema | Izbere kategorijo, vpiše pogodbeno stranko in roke |
| 3. Iskanje | Ročno pregledovanje map | Iskanje po podatkih in po vsebini dokumentov, tudi skeniranih, ter filtri |
| 4. Opozorilo | Odvisno od spomina | Aplikacija prikaže pogodbe, ki zahtevajo ukrepanje, in o njih obvesti po e-pošti |
| 5. Zaključek | Pogosto prepozno | Uporabnik pogodbo podaljša ali prekine |

## Podatki o pogodbi

| Podatek | Obvezen | Opomba |
|---|---|---|
| Naziv | da | |
| Pogodbena stranka | da | |
| Kategorija | da | Najem, Dobava, Storitve, Zaposlitev, Zavarovanje, Licence in naročnine, Drugo |
| Datoteka PDF ali DOCX | da | PDF privzeto do 100 MB, DOCX do 30 MB |
| Datum začetka | da | |
| Datum poteka | da, razen pri pogodbi za nedoločen čas | ne sme biti pred datumom začetka |
| Številka pogodbe | ne | |
| Odpovedni rok | ne | v dneh, privzeto 0 |
| Opozorilo | da | število dni pred rokom za ukrepanje, privzeto 30 |
| Priloge in aneksi | ne | do 30 datotek PDF ali DOCX |
| Vrednost | ne | v evrih; enkratno, mesečno ali letno |
| Opombe | ne | |

## Pravila

**Rok za ukrepanje** je datum poteka, zmanjšan za odpovedni rok. Do tega dne se mora uporabnik odločiti, ali bo pogodbo podaljšal ali prekinil.

Primer: pogodba poteče 31. 3. 2027, odpovedni rok je 30 dni, opozorilo 30 dni. Rok za ukrepanje je 1. 3. 2027, opozorilo se pojavi 30. 1. 2027.

Status se izračuna iz datumov, zato je vedno točen:

| Status | Pogoj |
|---|---|
| Aktivna | pogodba že velja, opozorilo še ni nastopilo ali je sklenjena za nedoločen čas |
| Še ni v veljavi | datum začetka je v prihodnosti in opozorilo še ni nastopilo |
| Kmalu poteče | opozorilo je nastopilo, datum poteka še ni minil |
| Potekla | datum poteka je minil |
| Prekinjena | uporabnik je pogodbo ročno prekinil; ta status ima prednost pred ostalimi |

Podaljšanje pomeni vnos novega datuma poteka. Pogodba se s tem vrne med aktivne, če do novega opozorila še ni prišlo.

## Obseg prve različice

Vključeno: registracija, prijava in odjava, nalaganje PDF in DOCX, vnos, pregled, urejanje in brisanje pogodb, iskanje in filtri, nadzorna plošča, opozorila v aplikaciji, podaljšanje in prekinitev, svetla in temna tema, slovenski in angleški vmesnik, priloge in aneksi, izvoz arhiva (ZIP s PDF in preglednico), iskanje po vsebini z regularnimi izrazi in prepoznavo besedila (OCR), razdelitev ene datoteke na več pogodb in aneksov, predogled PDF ob obrazcu, branje rokov in zneskov iz PDF z umetno inteligenco (neobvezno, z dovoljenjem skrbnika), skrbniško upravljanje uporabnikov in dovoljenj, prijava prek ponudnika OpenID Connect, ponastavitev gesla in opozorila po e-pošti.

Ni vključeno: elektronski podpis, potrjevanje pogodb, skupna raba pogodb, zgodovina različic, pogovorni pomočnik.
