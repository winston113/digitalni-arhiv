# Digitalni arhiv pogodb

[English](README.en.md)

Spletna aplikacija za manjša podjetja, ki na enem mestu hrani pogodbe in pravočasno opozori na njihov potek.

Projekt pri predmetu Informatika v podjetju, 1. letnik, Računalništvo in informatika.

## Namen

V manjših podjetjih so pogodbe pogosto razpršene po e-pošti, mapah in predalih. Zato je težko najti pravo pogodbo, roki za odpoved ali podaljšanje pa se spregledajo. Aplikacija ta proces poenostavi v štiri korake:

1. nalaganje pogodbe v obliki PDF,
2. določitev kategorije in rokov,
3. iskanje po arhivu,
4. opozorilo pred potekom ter podaljšanje ali prekinitev pogodbe.

Vmesnik je v slovenščini in angleščini. Jezik izberete v glavi poleg teme; privzeta je slovenščina.

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
| Uporabniški vmesnik | React, TypeScript, Vite |
| Strežnik | Node.js |
| Podatkovna baza | SQLite |
| Prijava | e-pošta in geslo, neobvezno OpenID Connect (npr. Zitadel) |
| Pošta | SMTP (npr. Mailjet) |
| Objava | vsebnik (Docker ali Podman) za povratnim posrednikom Caddy |

## Navodila za zagon

Aplikacija je en vsebnik. Baza in datoteke PDF so v eni mapi (`/data`). Potrebujete Docker s Compose.

```sh
git clone https://github.com/winston113/digitalni-arhiv.git
cd digitalni-arhiv
cp .env.example .env      # nastavite BASE_URL in po želji ostalo
docker compose up -d --build
```

`BASE_URL` mora biti natanko naslov, ki ga uporabniki odprejo v brskalniku. Za preizkus na svojem računalniku nastavite `BASE_URL=http://localhost:3000` in `TRUST_PROXY=false`.

Vse nastavitve so opisane v [.env.example](.env.example).

### Prvi skrbnik

Prvi ustvarjeni račun samodejno postane skrbnik, ne glede na način registracije. Zato se registrirajte, **preden aplikacijo odprete drugim**, nato po potrebi nastavite `REGISTRATION=false` in znova zaženite vsebnik.

Skrbnik v razdelku Skrbništvo ustvarja račune, ponastavlja gesla, blokira in briše uporabnike ter vsakemu določi, ali sme pogodbe dodajati, urejati in brisati. Tujih pogodb ne vidi.

### Javna predstavitvena različica

Teče ločeno od zasebne namestitve, z lastnimi podatki in omejenimi viri.

```sh
cp .env.demo.example .env.demo      # nastavite DEMO_BASE_URL
docker compose -f docker-compose.demo.yaml --env-file .env.demo up -d --build
```

1. Skrbnika ustvarite, preden je naslov javen: v Caddyju dostop najprej omejite na svoje omrežje (spodaj).
2. V razdelku Skrbništvo ustvarite testni račun; izklopite »mora ob naslednji prijavi spremeniti geslo«.
3. Dodajte vzorčne pogodbe: `docker compose -f docker-compose.demo.yaml --env-file .env.demo exec arhiv node dist/server/cli.js demo <e-pošta>`
4. V Caddyju odstranite omejitev.

```
arhiv-demo.primer.si {
    @zunaj not remote_ip private_ranges
    respond @zunaj 403              # odstranite, ko je skrbnik ustvarjen
    reverse_proxy 127.0.0.1:3100
}
```

Po ocenjevanju: `docker compose -f docker-compose.demo.yaml --env-file .env.demo down -v` (izbriše tudi podatke).

### Caddy

```
arhiv.primer.si {
    reverse_proxy 127.0.0.1:3000
}
```

Pri tem nastavite `TRUST_PROXY=true`. Če Caddy teče na drugem strežniku, vpišite naslov gostitelja in v `.env` ustrezno nastavite `BIND`.

### Zitadel ali drug ponudnik OpenID Connect

Ponudnika nastavi skrbnik v aplikaciji (Skrbništvo, Zunanja prijava), brez ponovnega zagona. Deluje z vsakim ponudnikom OpenID Connect, na primer Zitadel, Keycloak ali Authentik.

1. Pri ponudniku ustvarite spletno aplikacijo in vpišite naslov za preusmeritev, ki ga pokaže aplikacija: `https://arhiv.primer.si/api/auth/callback/oidc`.
2. V aplikaciji vpišite naslov ponudnika, ID odjemalca in način overjanja (PKCE brez skrivnosti, Basic ali POST), enak kot pri ponudniku.
3. Izberite Preveri povezavo in shranite.

Namesto tega lahko uporabite spremenljivke `OIDC_*`; te imajo prednost. Za preizkus na `http://localhost` v Zitadelu vklopite razvojni način (Development Mode).

Prijava in registracija prek ponudnika sta ločeni: nov račun nastane samo z gumbom na strani Registracija. Račun z geslom in račun ponudnika z istim e-poštnim naslovom se zaradi varnosti ne združita samodejno.

**Prijava z geslom je vedno na voljo kot rezerva.** Ob nastavljenem ponudniku je na strani Prijava pod povezavo »Prijava z računom … ne deluje?«. Kdor se prijavlja prek ponudnika, si rezervno geslo nastavi na strani Moj račun, lahko pa mu ga nastavi tudi skrbnik.

### Mailjet ali drug strežnik SMTP

Pošto nastavi skrbnik v aplikaciji (Skrbništvo, E-pošta): strežnik `in-v3.mailjet.com`, vrata 587, STARTTLS, ključ API kot uporabniško ime, skrivni ključ kot geslo in potrjen naslov pošiljatelja. Geslo je v bazi šifrirano. Namesto tega lahko uporabite spremenljivke `SMTP_*`; te imajo prednost.

Pošta se uporablja za:

- **opozorila pred potekom**: enkrat na dan povzetek novih opozoril, prvič ob začetku opozorila, nato teden pred rokom za ukrepanje in ob poteku;
- **ponastavitev gesla**, na zahtevo uporabnika ali skrbnika;
- **potrditev e-poštnega naslova**, ki je pogoj za prejemanje opozoril.

Uporabnik opozorila izklopi na strani Moj račun.

### Skrbniški ukazi

```sh
docker compose exec arhiv node dist/server/cli.js geslo uporabnik@primer.si   # novo geslo
docker compose exec arhiv node dist/server/cli.js skrbnik uporabnik@primer.si # vloga skrbnika
docker compose exec arhiv node dist/server/cli.js demo uporabnik@primer.si    # vzorčne pogodbe v prazen arhiv
```

### Varnostna kopija

Ustavite vsebnik (`docker compose stop`), kopirajte celoten nosilec `podatki` in ga znova zaženite. Kopija vsebuje bazo, datoteke PDF in skrivnost za seje.

Če namesto nosilca uporabite mapo na gostitelju, mora vanjo lahko pisati uporabnik 1000 oziroma uporabnik, ki ga nastavite z `user:` v `compose.yaml` (na Unraidu običajno `99:100`).

### Podman

Docker Compose deluje tudi s Podmanom:

```sh
systemctl --user enable --now podman.socket
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/podman/podman.sock
```

## Razvoj

Potrebujete Node.js 24.

```sh
npm ci --ignore-scripts
npm run dev:server        # strežnik na vratih 3000
npm run dev:web           # vmesnik na vratih 5173
npm test
```

Pri razvoju strežnik zaženite z `BASE_URL=http://localhost:5173`.

## Časovnica

| Sprint | Obdobje | Vsebina |
|---|---|---|
| 1 | 23. 11. – 29. 11. 2026 | Analiza in oblikovanje |
| 2 | 30. 11. – 6. 12. 2026 | Gradnja aplikacije |
| 3 | 7. 12. – 10. 12. 2026 | Dodelava in predstavitev |

## Licenca

Projekt je odprtokoden pod [licenco MIT](LICENSE). Licence uporabljenih knjižnic so v [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md). Pisava IBM Plex Sans je pod licenco SIL OFL 1.1.
