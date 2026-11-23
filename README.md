# Digitalni arhiv pogodb

Spletna aplikacija za manjša podjetja, ki na enem mestu hrani pogodbe in pravočasno opozori na njihov potek.

Projekt pri predmetu Informatika v podjetju, 1. letnik, Računalništvo in informatika.

## Namen

V manjših podjetjih so pogodbe pogosto razpršene po e-pošti, mapah in predalih. Zato je težko najti pravo pogodbo, roki za odpoved ali podaljšanje pa se spregledajo. Aplikacija ta proces poenostavi v štiri korake:

1. nalaganje pogodbe v obliki PDF,
2. določitev kategorije in rokov,
3. iskanje po arhivu,
4. opozorilo pred potekom ter podaljšanje ali prekinitev pogodbe.

## Dokumentacija

- [Opis procesa](docs/opis-procesa.md)
- [Uporabniški tok in zasloni](docs/uporabniski-tok.md)
- [Design sistem](design/project/README.md)
- [Sprint poročilo 1](docs/porocila/sprint-1.md)

## Uporabljena orodja

| Področje | Orodje |
|---|---|
| Oblikovanje | Claude Design |
| Razvoj | Claude Code |
| Uporabniški vmesnik (načrtovano) | React, TypeScript, Vite |
| Strežnik (načrtovano) | Node.js |
| Podatkovna baza (načrtovano) | SQLite |
| Prijava (načrtovano) | e-pošta in geslo, neobvezno OpenID Connect (npr. Zitadel) |
| Pošta (načrtovano) | SMTP (npr. Mailjet) |
| Objava (načrtovano) | vsebnik (Docker ali Podman) za povratnim posrednikom Caddy |

## Navodila za zagon

Projekt je v fazi analize in oblikovanja. Navodila za zagon bodo dodana v drugem sprintu, skupaj s programsko kodo.

## Časovnica

| Sprint | Obdobje | Vsebina |
|---|---|---|
| 1 | 23. 11. – 29. 11. 2026 | Analiza in oblikovanje |
| 2 | 30. 11. – 6. 12. 2026 | Gradnja aplikacije |
| 3 | 7. 12. – 10. 12. 2026 | Dodelava in predstavitev |
