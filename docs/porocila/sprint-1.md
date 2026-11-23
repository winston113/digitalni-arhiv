# Sprint poročilo 1: Analiza in oblikovanje

Obdobje: 23. 11. – 29. 11. 2026. Osnutek, stanje 23. 11. 2026.

## Kaj smo naredili

- Opisali smo poslovni proces, uporabnika in pravila za roke ter statuse.
- Določili smo uporabniški tok in sedem zaslonov.
- Pripravili smo mini design sistem: temno zelena primarna barva, pisava IBM Plex Sans, razmiki, 17 komponent, svetla in temna tema, znak in pravila za besedila.
- Oblikovali smo sedem zaslonov za računalnik in telefon ter stanja (prazno, nalaganje, napake, pogovorno okno).
- Namesto oblačnih storitev smo izbrali vsebnik, ki ga je mogoče gostiti na lastnem strežniku.

## Kaj ni uspelo in zakaj

- Funkcijo umetne inteligence smo izpustili iz prve različice, ker ima prednost delujoč glavni proces.

## Ključni prompti

1. Začetni prompt (odlomek): »We have been tasked with making a digital contract archive. [...] Before we start designing and coding and whatnot, we should create a github repo and flesh out a general idea how this will look and work. As the plan specifies, the project or "app" should be simple and user friendly, it should not look blatantly vibe-coded, so make it consistent throughout every page. Absolutely ZERO emojis allowed, this is non-negotiable.«
   Učinek: najprej proces in oblikovanje, šele nato koda; enoten slog od začetka.

2. Popravki design sistema (odlomek): »Make light/dark/system theme choices. A persistent button across all pages that defaults to system. [...] Make the logo and/or name clickable that redirects back to the main home page.«
   Učinek: tema in glava sta postali del sistema, še preden so nastali zasloni.

3. Gostovanje (odlomek): »I am already running Zitadel on my own server and domain, could we maybe use my already existing infrastructure as an OAuth provider? [...] I could use my Proxmox or UNRAID server to host this application, I already have Caddy as a reverse proxy and my own domain.«
   Učinek: namesto oblačnih storitev en vsebnik z lastno bazo, prijava prek obstoječega ponudnika identitete in pošta prek SMTP.

## Plan za naslednji sprint

- Aplikacija z registracijo, prijavo in celotnim procesom pogodbe po pripravljenih zaslonih.
- Podatkovna baza z ločenimi podatki po uporabnikih in zgodnja objava na javnem naslovu.
