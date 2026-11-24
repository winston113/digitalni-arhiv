# Sprint poročilo 1: Analiza in oblikovanje

Obdobje: 23. 11. – 29. 11. 2026. Stanje: 24. 11. 2026.

## Kaj smo naredili

- **Analiza:** opis procesa, uporabnik, pravila za roke in statuse, uporabniški tok.
- **Oblikovanje:** mini design sistem (17 komponent, svetla in temna tema) ter klikljivi zasloni za računalnik in telefon s praznimi stanji, nalaganjem in napakami.
- **Pred načrtom:** delujoča aplikacija (različica 1.0.0) s celotnim procesom od nalaganja pogodbe do podaljšanja ali prekinitve, registracijo, ločenimi podatki po uporabnikih, opozorili po e-pošti, prilogami, izvozom ter slovenskim in angleškim vmesnikom. Preverja jo 89 samodejnih testov.

## Kaj ni uspelo in zakaj

- Predogledi design sistema sprva niso delovali, ker je agent objavil samo sloge brez skripte, objavljene strani pa ni preveril.
- Prvi poskus obnove varnostne kopije ni uspel zaradi lastništva datotek. Dodali smo preizkušena navodila in razumljivo sporočilo.
- Javni naslov še ni objavljen. Funkcijo umetne inteligence smo odložili, ker ima prednost glavni proces.

## Ključni prompti

1. »The project or "app" should be simple and user friendly, it should not look blatantly vibe-coded, so make it consistent throughout every page. Absolutely ZERO emojis allowed, this is non-negotiable.« Najprej oblikovanje, nato koda; enoten slog od začetka.
2. »Make light/dark/system theme choices. A persistent button across all pages that defaults to system.« Tema je del sistema, ne poznejši dodatek.
3. »I am already running Zitadel on my own server and domain, could we maybe use my already existing infrastructure as an OAuth provider?« Vsebnik na lastnem strežniku namesto oblačnih storitev.

## Plan za naslednji sprint

- Javna predstavitvena različica s testnim računom in namestitev na lastni strežnik.
- Iskanje po vsebini dokumentov s prepoznavo besedila (OCR).
- Preizkus s pravimi uporabniki in popravki.
