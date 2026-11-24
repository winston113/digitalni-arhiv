# Namestitev na Unraid

[English](unraid.en.md)

Dve ločeni namestitvi: zasebni arhiv in po potrebi javna predstavitvena različica. Primeri predvidevajo bazen z imenom `cache`; če ima vaš drugo ime, prilagodite pot.

**Podatki naj bodo na poti bazena (`/mnt/cache/...`), ne na `/mnt/user/...`.** Baza je SQLite, uporabniki pa poročajo o poškodbah baz na združenem pogledu `/mnt/user`. Skupna mapa `appdata` mora ostati na bazenu (brez polja diskov kot drugotne shrambe).

## 1. Priprava

Na zavihku Apps namestite **Compose Manager Plus**, ki doda ukaz `docker compose`. Nato v terminalu Unraida:

```sh
mkdir -p /mnt/cache/appdata/digitalni-arhiv/data /mnt/cache/appdata/digitalni-arhiv/data-demo
chown -R 99:100 /mnt/cache/appdata/digitalni-arhiv/data /mnt/cache/appdata/digitalni-arhiv/data-demo
cd /mnt/cache/appdata/digitalni-arhiv
```

V to mapo kopirajte `docker-compose.yaml`, `docker-compose.demo.yaml`, `.env.example` (kot `.env`) in `.env.demo.example` (kot `.env.demo`).

## 2. Slika vsebnika

Dokler je paket zaseben, je najpreprosteje poslati sliko z računalnika, na katerem je zgrajena:

```sh
podman save ghcr.io/winston113/digitalni-arhiv:1.2.0 | ssh root@UNRAID docker load
```

Compose uporabi lokalno sliko in je ne prenaša znova. Če je paket javen, ta korak izpustite.

## 3. Zasebni arhiv

V `.env`:

```
BASE_URL=https://arhiv.primer.si
BIND=IP-UNRAIDA:3000
TRUST_PROXY=true
DATA=/mnt/cache/appdata/digitalni-arhiv/data
PUID=99
PGID=100
```

```sh
docker compose up -d --no-build
docker compose logs
```

V Caddyju:

```
arhiv.primer.si {
    reverse_proxy IP-UNRAIDA:3000
}
```

Registrirajte se; s tem postanete skrbnik. Nato nastavite `REGISTRATION=false` in znova zaženite `docker compose up -d --no-build`. Nazadnje nastavite pošto in na strani Moj račun potrdite svoj naslov.

Pri `TRUST_PROXY=true` naj vrata 3000 doseže samo Caddy.

## 4. Javna predstavitvena različica

V `.env.demo`:

```
DEMO_BASE_URL=https://arhiv-demo.primer.si
DEMO_BIND=IP-UNRAIDA:3100
DEMO_DATA=/mnt/cache/appdata/digitalni-arhiv/data-demo
DEMO_PUID=99
DEMO_PGID=100
```

```sh
docker compose -f docker-compose.demo.yaml --env-file .env.demo up -d --no-build
```

Najprej jo odprite samo svojemu omrežju, da skrbnika ustvarite vi:

```
arhiv-demo.primer.si {
    @zunaj not remote_ip private_ranges
    respond @zunaj 403
    reverse_proxy IP-UNRAIDA:3100
}
```

1. Registrirajte skrbnika.
2. V razdelku Skrbništvo ustvarite testni račun in izklopite »mora ob naslednji prijavi spremeniti geslo«.
3. Dodajte vzorčne pogodbe:
   `docker compose -f docker-compose.demo.yaml --env-file .env.demo exec arhiv node dist/server/cli.js demo test@primer.si`
4. Odstranite vrstici `@zunaj` in znova naložite Caddy.

Če se je pred vami registriral kdo drug, si vlogo podelite z `... exec arhiv node dist/server/cli.js skrbnik vi@primer.si` in drugi račun izbrišite.

### Ločitev od domačega omrežja

Predstavitvena različica ne potrebuje izhodnih povezav, razen če na njej uporabljate pošto ali OpenID Connect. Preprečite jih, da tudi ob morebitnem vdoru ne doseže domačega omrežja:

```sh
iptables -I DOCKER-USER -i br-arhivdemo -m conntrack --ctstate NEW -j DROP
iptables -I INPUT -i br-arhivdemo -m conntrack --ctstate NEW -j DROP
```

Pravili po ponovnem zagonu izgineta. Dodajte ju v `/boot/config/go` po preverjanju, da Docker teče, ali ju zaženite z vtičnikom User Scripts ob zagonu polja.

Po ocenjevanju: `docker compose -f docker-compose.demo.yaml --env-file .env.demo down`, nato odstranite naslov v Caddyju in mapo `data-demo`.

## 5. Varnostna kopija

```sh
cd /mnt/cache/appdata/digitalni-arhiv
docker compose stop
tar czf /mnt/user/backups/arhiv-$(date +%F).tgz -C data .
docker compose start
```

Obnova: ustavite, izpraznite `data`, `tar xzf DATOTEKA -C data`, `chown -R 99:100 data`, zaženite.

## 6. Nadgradnja

Naredite kopijo, spremenite različico slike v datoteki Compose, naložite ali prenesite novo sliko in zaženite `docker compose up -d --no-build`.
