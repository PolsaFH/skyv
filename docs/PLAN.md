# Plan for Skyv

Kort plan for hvordan Skyv bygges. Detaljerte valg står i README under "Valg underveis".

## Oppbygning

- `src/core`: ren logikk uten Electron: lagring (atomisk JSON), nettsidemodell, skanning og hashing,
  sammenligning, ignorer-regler, referanseskanner, feilfangere, sammendrag, opplasting og angre
  (bak et felles grensesnitt for FTP, FTPS og SFTP). Alt her testes med vitest.
- `src/main`: tjenester: vinduer, menylinje, varsler, nøkkelring (`safeStorage`), filovervåking,
  arbeidstråd for skanning, IPC-håndterere som kaller `src/core`.
- `src/preload`: ett typet API (`window.skyv`) som er det eneste renderer får se.
- `src/renderer`: React-grensesnitt på norsk, systemfont, lys og mørk modus.
- `tests`: enhetstester og integrasjonstester mot lokal `ftp-srv`.

## Lagring

Alt ligger under `userData`:

- `sites.json`: liste over nettsider (uten passord).
- `secrets/<id>.bin`: passord kryptert med `safeStorage` (nøkkelringen).
- `sites/<id>/manifest.json`, `releases.json`, `snapshots/<utgivelse>/`, `log.jsonl`, `ignored-findings.json`.
- En "pågående utgivelse"-fil skrives før opplasting starter og fjernes etterpå, slik at appen kan tilby
  å fullføre eller angre etter krasj.

## Milepæler

1. Oppsett, vindu, sidepanel, lagring av nettsider, passord i nøkkelringen.
2. Veiviser med tilkoblingstest, automatisk funn av rotmappe, valg av utgangspunkt.
3. Skanning, manifest, endringsliste med tekst- og bildeforskjeller, ignorer-regler.
4. Opplasting med snapshot, midlertidige filnavn, retry og angre.
5. Beskyttelse mot overskriving og avhengighetsskanning.
6. Feilfangere før utgivelse.
7. Sjekk etter opplasting med valgfri automatisk angring.
8. Menylinjeapp, bakgrunnsovervåking, økter og varsler.
9. Før og etter-sammenligning med lokal forhåndsvisning.
10. Sammendrag, historikk, logg, eksport og import.
11. Polering, README, .dmg.

Hver milepæl avsluttes med grønne tester, en sjekk av at appen starter, og en commit.

## Viktigste sikkerhetsregler

- Ingenting slettes lokalt eller på serveren uten at brukeren har valgt det.
- Snapshot tas før noe overskrives eller slettes på serveren.
- Manifestet oppdateres først når en fil er bekreftet lastet opp.
- Alle stier sjekkes mot nettsidens mappe og den eksterne rotmappen.
- Passord finnes bare kryptert i nøkkelringen, aldri i logger, feilmeldinger eller eksport.

---

# Runde 2: serversjekk, AI-tilkobling og AI-arbeidsflyt

## Del 1: Serversjekk (milepæl 1 og 2)

- `src/core/serverCheck`: én tilkobling lister serverens rotmappe én gang per mappe (MLSD når serveren støtter det, ellers LIST), og sammenligner med manifestet og mappen på Macen. Resultatet er tre typer avvik: mangler på serveren, endret på serveren, og bare på serveren. Ignorer-regler og Skyvs egne midlertidige filer tas ikke med.
- Valg per avvik ligger også i kjernen: last opp på nytt, slett på Macen (via Papirkurven), la den være borte, hent serverens versjon, overskriv med min, hent til Macen, og la være. Hvert valg oppdaterer manifestet og logges.
- Grensesnitt: seksjonen "Avvik på serveren" over endringslisten, "Sjekk serveren", automatisk sjekk ved åpning (eldre enn 5 minutter), valgfri bakgrunnssjekk hvert 15. minutt, en gul linje over "Gi ut" og en markering i menylinjen.

## Del 2: AI-tilkobling (milepæl 3 til 6)

- `src/core/agentApi`: ett API med tillatelser (Bare se / Se og klargjøre / Se, klargjøre og gi ut), klientgodkjenning, begrensning på antall kall, logging og rensing av hemmeligheter. API-et bruker de samme tjenestene som grensesnittet.
- Hovedprosessen lytter på en Unix-socket (0600) i datamappen.
- `skyv-mcp`: en egen bro (stdio til socket) med `@modelcontextprotocol/sdk`, som kjøres med appens egen Electron (`ELECTRON_RUN_AS_NODE=1`). Den starter Skyv hvis appen ikke kjører.
- `skyv`: en kommandolinje mot det samme API-et.
- Utkast til utgivelser, et bånd i appen, utgivelse på nivå 3 bak de harde sperrene, og forespørsel om angring.
- Innstillingssiden "AI-tilkobling" med kopiérbart oppsett for Claude Code og Claude-appen, og installering av `skyv` i `~/.local/bin`.

## Del 3: AI-arbeidsflyt og historikk (milepæl 7 og 8)

- Kompakte tekstforskjeller lagres per utgivelse (opptil 200 KB per fil, 50 MB per nettside), med filhistorikk og sammenligning av utgivelser i API og grensesnitt.
- En seksjon i `CLAUDE.md` mellom markører. `CLAUDE.md`, `AGENTS.md` og `.claude/` kommer på standard ignorer-liste, med migrering for eksisterende nettsider.
- Etter-opplasting-løkke: feil fra sjekken returneres til AI-en.

## Milepæl 9: polering, README, sjekkliste og ny .dmg
