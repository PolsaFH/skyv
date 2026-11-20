# Logg: bygging av Skyv

Denne loggen oppsummerer alt som ble bygget, hvilke valg som ble tatt, hva som er testet og hva som gjenstår. Den er skrevet for å kunne leses av en annen AI (eller en person) som skal hjelpe til med å planlegge forbedringer. Den er selvstendig: du trenger ikke kode eller tidligere samtaler for å forstå den.

Dato: 11. november 2026. Alle 11 milepæler er ferdige og lagret som egne commits i git.

**Oppdatert 12. november 2026:** Runde 2 (serversjekk, AI-tilkobling og historikk) er ferdig. Se del 10 nederst. Delene 1 til 9 beskriver runde 1.

---

## 1. Kort om prosjektet

**Skyv** er en gratis, lokal Mac-app (Electron + TypeScript + React + Vite) som gir ut endringer på nettsider til et webhotell via FTP, FTPS eller SFTP. Den er "GitHub Desktop for FTP-nettsider".

**Målgruppen** er folk som lager nettsider sammen med AI. De er ikke utviklere, bruker ikke git og vil ikke ha abonnement. Sidene er statiske (HTML/CSS/JS) eller bruker PHP (ikke WordPress), og de har ofte mange nettsider.

**Kjerneidé:** Brukeren tenker i *utgivelser*, ikke i filer. Noe er endret lokalt, brukeren "gir det ut", og hver utgivelse kan angres. Alt i appen er på norsk bokmål uten fagord (ikke commit, diff, push, manifest, hash). Det er heller ingen tankestreker i tekst brukeren ser.

**Regler fra brukeren** (fra `CLAUDE.md`):
- Kode og kommentarer på engelsk, alt brukeren ser på norsk.
- Kjør testene før hver commit, og commit etter hver milepæl.
- Test aldri mot en ekte FTP-server. Testene bruker en lokal testserver, og brukeren tester selv mot en testmappe på webhotellet.
- Passord aldri i klartekst, logger eller feilmeldinger. Bruk macOS-nøkkelringen.
- Slett aldri filer lokalt eller på serveren uten at brukeren har valgt det.
- Kjernelogikken i `src/core` skal være ren og testbar uten Electron.

---

## 2. Tall

| | |
|---|---|
| Milepæler | 11 av 11 ferdige, pluss en egen PHP-leveranse |
| Commits | 12 |
| Kode | omtrent 10 400 linjer TypeScript i `src` |
| Tester | 195 tester i 26 filer, omtrent 2 300 linjer, alle grønne |
| Ytelse | 5000 filer: første skanning ~0,8 s, ny skanning ~0,55 s, sjekker før utgivelse ~0,4 s (Apple-Mac) |
| Leveranse | `Skyv-0.1.0-arm64.dmg` og `Skyv-0.1.0-x64.dmg` (ca. 125 MB hver), ikke signert |

---

## 3. Arkitektur

- `src/core`: all logikk, uten Electron. Lagring (atomisk JSON), nettsider, passordlager, skanning og hashing, ignorer-regler, manifest, endringsoppdagelse, tekstforskjeller, tilkobling (FTP/FTPS/SFTP bak ett grensesnitt), opplasting, angre, konflikter, avhengigheter, feilfangere, sjekk etter opplasting, forhåndsvisningsserver, økter, sammendrag, logg, eksport og import.
- `src/main`: Electron-hovedprosessen. Vinduer, menylinje, varsler, nøkkelring (`safeStorage`), bakgrunnsovervåking, skjermbilder, IPC.
- `src/preload`: ett typet API (`window.skyv`), det eneste grensesnittet ser.
- `src/renderer`: React-grensesnitt med systemfont og lys og mørk modus.
- `tests`: vitest. Integrasjonstester bruker en lokal FTP-server (`ftp-srv`) og PHP sin innebygde webserver der PHP er installert.

**Lagring** under `~/Library/Application Support/Skyv/`: JSON-filer, ingen database. Per nettside: manifest, historikk, sikkerhetskopier, økter, ignorerte funn, logg og en "pågår"-fil under utgivelse.

**Sikkerhetsgrenser:**
- Grensesnittet får aldri se passord, bare om ett er lagret.
- Hovedprosessen godtar bare endringer den selv har funnet. Grensesnittet sender bare nøkler for det som er valgt.
- Hovedprosessen kjører sjekkene på nytt før opplasting, så sperrer kan ikke omgås.

**Avhengigheter i appen:** `basic-ftp`, `ssh2-sftp-client`, `ignore`, `diff` og `@anthropic-ai/sdk`. `chokidar` og `ignore` pakkes inn i koden. React er bare i grensesnittet.

---

## 4. Milepæl for milepæl

### Milepæl 1: Oppsett, vindu, sidepanel, lagring, nøkkelring
- Vindu med sidepanel (nettsider med statusprikk og antall) og tomtilstanden "Dra en mappe hit for å komme i gang". Du kan dra en mappe hvor som helst i vinduet.
- Nettsider lagres atomisk (midlertidig fil, fsync, så omdøping). En ødelagt fil flyttes til side og slettes aldri.
- Passord krypteres med `safeStorage` (nøkkelen ligger i nøkkelringen). Hvis nøkkelringen ikke er tilgjengelig, nekter appen å lagre passordet heller enn å lagre det ukryptert.
- Ukjente feil byttes ut med en generell norsk melding, så tekniske detaljer eller passord aldri vises.

### Milepæl 2: Veiviser for ny nettside
- Fem steg: mappe, webhotell, mappe på serveren, nettadresse, utgangspunkt.
- "Test tilkobling" med vennlige feilmeldinger for:
  - feil passord
  - ukjent vert
  - feil port
  - ingen kontakt
  - sertifikatfeil
  - server uten FTPS
  - for mange tilkoblinger
  - SFTP-handshake mot en FTP-server

  Hver feil har et forslag til hva brukeren kan gjøre. Serverens egen feiltekst vises aldri ordrett.
- Automatisk funn av rotmappe: ser i noen få sannsynlige mapper (`public_html`, `www`, `htdocs`, `httpdocs`, `web`, `domains/<navn>` …), maks 20 oppslag, og sammenligner med filene øverst i den lokale mappen. `index.*` teller mest. Brukeren kan også bla selv.
- SFTP: serverens identitet huskes ved første tilkobling, og en endret identitet stopper med forklaring.

### Egen leveranse: PHP-støtte (ønsket underveis)
- Finner PHP i PATH og i tillegg `/opt/homebrew/bin/php` og `/usr/local/bin/php`, fordi apper åpnet fra Finder ikke får Terminal sin PATH. Verifisert i den pakkede appen.
- Syntakssjekk med `php -l` (filen kjøres ikke) og lokal forhåndsvisning med `php -S` (bare 127.0.0.1).
- Innstillingene viser "PHP er funnet (versjon 8.5.12)" eller en forklaring.

### Milepæl 3: Skanning, manifest, endringsliste, ignorer-regler
- Skanning i egen tråd (worker) med hurtigbuffer for hash basert på størrelse og endringstid.
- Endringer: ny, endret, slettet og omdøpt. Omdøping oppdages ved likt innhold, også når bare store og små bokstaver er endret.
- Liste gruppert etter mappe, med søk og filter. Slettinger er røde og aldri valgt som standard.
- Forskjeller: tekst linje for linje (røde og grønne linjer med linjenummer), og bilder før og etter.
- Tekstfiler (opptil 1 MB) som er gitt ut, lagres lokalt så forskjeller vises uten serveren. Bilder hentes fra serveren ved behov.
- Utgangspunkt:
  - "Start herfra"
  - "Last opp alt"
  - "Sammenlign med serveren": "rask sjekk" ser på størrelse, "grundig sjekk" laster ned og sammenligner innhold

  Filer som bare finnes på serveren, røres aldri.
- Ignorer-regler: standardlisten (`.git`, `node_modules`, `.DS_Store`, `.env*`, `*.log`, valgfritt `*.map` …), `.skyvignore` og en editor i innstillingene. En ignorert fil vises aldri som slettet, så en ny regel kan ikke føre til sletting på serveren.
- Symbolske lenker følges bare innenfor mappen.

### Milepæl 4: Opplasting, sikkerhetskopi, nye forsøk, angre
- Sikkerhetskopi av alle filer som blir erstattet eller slettet tas før noe endres. Mislykkes sikkerhetskopien for en fil, røres ikke den filen.
- Hver fil lastes opp som `.navn.xxxxxxxx.skyvtmp` og døpes om når den er ferdig, så siden aldri viser halve filer. Rester fra avbrutte forsøk ryddes, men bare filer med akkurat dette mønsteret.
- Tre samtidige tilkoblinger (kan endres). Opptil 4 forsøk med økende pause (1, 2, 4 s) og ny tilkobling. Filer som feiler stopper ikke resten, og vises med forklaring og "Prøv igjen".
- Manifestet oppdateres bare for bekreftede filer, i små porsjoner (hvert halve sekund).
- Omdøpte filer flyttes på serveren uten ny opplasting.
- Sletting krever avkrysning og en egen bekreftelse med liste.
- Krasj: en "pågår"-fil gjør at neste oppstart tilbyr "Fullfør utgivelsen", "Angre det som ble gjort" eller "Ikke gjør noe". Testet ved å tvangsavslutte appen midt i en opplasting på 200 MB.
- Angre hele utgivelsen eller utvalgte filer fra historikken, med bekreftelse som viser hva som settes tilbake og hva som fjernes. Filene på Macen røres aldri.
- Sikkerhetskopier ryddes: som standard de 20 nyeste og maks 500 MB.

### Milepæl 5: Beskyttelse mot overskriving og avhengigheter
- Før utgivelse sammenlignes serverens størrelse og endringstid med det som ble registrert rett etter forrige opplasting. Endringstid brukes bare når serveren oppgir den nøyaktig (MLSD eller SFTP), med ett sekunds toleranse. Konflikter gir en dialog per fil med "Behold min versjon", "Hopp over" (standard) og "Vis forskjell" (serverens versjon mot din).
- Avhengigheter: endrede HTML-, CSS-, JS- og PHP-filer skannes for `src`, `href`, `srcset`, `poster`, `url()`, `@import`, JS-`import` og PHP-`include`/`require` (også med `__DIR__`). Nye filer som trengs, velges automatisk med merkelappen "Trengs av index.html", også i flere ledd.
- Advarsler om filer som ikke finnes, filer på ignorer-listen, og lenker med feil store og små bokstaver (virker på Macen, men ikke på webhotellet).

### Milepæl 6: Feilfangere før utgivelse
- **Stopper (rød, krever "Jeg vet hva jeg gjør"):**
  - nøkler til OpenAI, Anthropic, AWS, Google, Stripe og GitHub
  - private nøkler
  - databasepassord i PHP-konfigurasjon
  - filer som `.env`, `.git`, `id_rsa`, `*.sql`, `*.bak`, `*.zip`, `.htpasswd` og `*.pem`

  Nøkler vises bare maskert (`sk-ant-…3Gf`).
- **Advarsler (gul):**
  - lokale lenker
  - ødelagte lenker
  - lorem ipsum, TODO og test123
  - PHP-syntaksfeil
  - ugyldig JSON
  - mange slettinger eller endringer
  - filer over 10 MB
- **Tips (blå):** `console.log`, store ubrukte bilder, manglende alt-tekst og manglende `<title>`.
- "Ignorer dette funnet" huskes per nettside, uavhengig av linjenummer.
- Tiltak mot falske alarmer: `localhost` som databasevert i PHP er riktig, CSS-klassenavn tas ikke for nøkler, og passordfelt i skjemaer flagges ikke.

### Milepæl 7: Sjekk etter opplasting
- Henter de endrede sidene fra den ekte nettadressen med `?skyv=<tid>`. Sjekker:
  - at siden svarer 2xx
  - at det ikke står PHP-feil i svaret, slik PHP skriver dem
  - at bilder, CSS, JS og skrifter som siden bruker, finnes og har riktig type, inkludert "soft 404", der serveren svarer med en HTML-side for en fil som mangler
- Endres bare en include, et stilark eller et bilde, sjekkes sidene som bruker den, ellers forsiden.
- Ved feil vises "Noe ser feil ut på siden din", med en kort forklaring og "Angre utgivelsen" med ett klikk. "Angre automatisk hvis sjekken feiler" er en innstilling per nettside, av som standard.
- Testet hele veien: opplasting over FTP, servert av PHP sin webserver, med en ekte PHP-feil som ble fanget og angret.

### Milepæl 8: Menylinje, bakgrunnsovervåking, økter, varsler
- Ikon i menylinjen med antall endringer som venter. Innstillingen avgjør om tallet gjelder alle nettsider eller den valgte.
- En liten oversikt med "Gi ut" per nettside. Den gir aldri ut slettinger og går gjennom de samme sjekkene. Ved noe alvorlig, konflikter eller manglende utgangspunkt sendes brukeren til hovedvinduet. Ved advarsler kan brukeren velge "Gi ut likevel".
- Overvåking med chokidar. Når filene har vært i ro i 8 sekunder (kan endres), blir det en økt. Listen oppdateres av seg selv, filene merkes "Økt 14:32", og et varsel spør "7 filer endret i minside.no. Klar til å gis ut?".
- Innstillinger for appen: start ved innlogging, fortsett i bakgrunnen, Dock-ikon, varsler og tallet i menylinjen. Uten Dock-ikon tvinges "fortsett i bakgrunnen" på.
- Bare én Skyv om gangen. Norske menyer med Rediger-meny for kopier og lim inn.

### Milepæl 9: Før og etter
- Skjermbilder av hele siden (opptil 6000 px), både den ekte og den lokale versjonen, tatt i et skjult vindu med isolert økt.
- Side ved side eller glidebryter, i bredden Datamaskin (1280 px) eller Mobil (390 px, med iPhone-identitet).
- Lokal forhåndsvisning: en egen liten server for statiske sider, og `php -S` for PHP-sider. Begge kun på 127.0.0.1, og begge nekter skjulte filer som `.env`. Uten PHP vises bare den ekte siden, med forklaring.
- "Åpne lokal forhåndsvisning i nettleseren" og "Åpne den ekte siden".

### Milepæl 10: Sammendrag, historikk, logg, eksport og import
- Notatfeltet over "Gi ut" fylles med et vanlig sammendrag, for eksempel "Endret 3 HTML-sider og 1 CSS-fil, la til 2 bilder, slettet 1 fil.". Det kan redigeres, og kan endres senere i historikken.
- **Valgfritt med AI (av som standard):** brukerens egen Anthropic-nøkkel (i nøkkelringen). Modellen er Claude Opus 5.5 via den offisielle SDK-en, med lav innsats og serverside-fallback.
  - Bare endrede linjer sendes.
  - Filer med funn om hemmeligheter sendes aldri, og linjer som ligner hemmeligheter byttes ut.
  - Første gang vises nøyaktig teksten som sendes, før noe sendes.
- Logg per nettside ("Vis logg"): lagt til og endret, utgangspunkt, sammenligning, utgivelser fil for fil, angring, sjekker, ignorerte funn, eksport og import. Passordet renses ut, og testene bekrefter at det ikke står i loggen.
- Eksport og import av oppsett uten passord. Ved import hoppes det over nettsider som finnes fra før.

### Milepæl 11: Polering og .dmg
- App-ikon: blå avrundet firkant med hvit pil opp og strek.
- Store lister vises i porsjoner på 400 rader ("Vis flere").
- Layouten ble rettet så knappen ikke overlapper historikken når mye vises.
- Gjennomgang av tekster: ingen fagord eller tankestreker i det brukeren ser.
- .dmg for Apple-prosessor og Intel. Den pakkede appen er testet hele veien: PHP funnet med Finder sin PATH, skanning i egen tråd, og utgivelse av 301 filer til testserveren. Intel-versjonen startet under Rosetta.

---

## 5. Hvordan det er testet

- **Automatiske tester (195):** lagring, nettsider, nøkkelring (med falsk kryptering), feilmeldinger, ignorer-regler, skanning (symlenker, æøå, hurtigbuffer), endringer og omdøping, tekstforskjeller, referanseskanner, avhengigheter, hemmelighetsskanner og sensitive filer, feilfangere, konflikter, rotmappe-funn, midlertidige navn, økter og overvåking (ekte mappe), forhåndsvisningsservere, sammendrag og AI-innhold (uten nettverk), logg, eksport og import, og ytelse (5000 filer).
- **Mot lokal FTP-testserver:** tilkobling, feil passord, port som nekter, listing med æøå, sammenligning, opplasting med brudd og nye forsøk (testserveren bryter forbindelsen med vilje), filer som feiler og "Prøv igjen", flere tilkoblinger, angre (serveren blir nøyaktig som før), angre utvalgte filer og rydding av sikkerhetskopier.
- **Med ekte PHP:** syntakssjekk, forhåndsvisning og sjekk etter opplasting, inkludert automatisk angring.
- **I appen** (styrt automatisk med Playwright mot Electron, med skjermbilder): alle milepælene, krasj midt i opplasting, og den pakkede appen.
- **Ikke testet:** ekte webhotell (det gjør brukeren selv mot en testmappe), SFTP mot en server, et ekte kall til Anthropic, og varsler og menylinjeikon sett på skjermen.

---

## 6. Valg og avvik fra beskrivelsen

- **"Angre utgivelsen" i det røde varselet etter opplasting** virker med ett klikk uten bekreftelse, slik beskrivelsen sa. Andre angringer har bekreftelse.
- **"Gi ut" fra menylinjen** tar aldri med slettinger, og sender brukeren til hovedvinduet ved noe alvorlig eller konflikter, i stedet for å spørre i den lille oversikten.
- **Konfliktdialogen** har "Hopp over" som standard (det tryggeste).
- **Veiviseren** krever vellykket tilkoblingstest før man kan gå videre.
- **Bilder lagres ikke lokalt** som "forrige versjon". De hentes fra serveren ved behov, for å spare plass.
- **"Fjern fra Skyv"** ligger i innstillingene for nettsiden, ikke på hovedskjermen.
- **AI-modell:** Claude Opus 5.5 (det anbefalte standardvalget), med lav innsats for å holde det raskt. Brukeren kan ønske en billigere modell, for eksempel Haiku.
- **Sjekk etter opplasting** kjøres også etter delvis vellykkede utgivelser.

---

## 7. Kjente begrensninger og svakheter

1. **Ikke signert eller notarisert av Apple.** Første åpning krever høyreklikk → Åpne, eller "Åpne likevel". Varselknappen "Se gjennom" kan mangle.
2. **SFTP er ikke testet mot en server.** Koden kompilerer og følger samme grensesnitt som FTP, men det finnes ingen lokal SFTP-testserver i testene.
3. **AI-sammendraget** er ikke kjørt med en ekte nøkkel.
4. **FTP uten MLSD** (eldre servere) gir ikke pålitelig endringstid. Da sammenlignes bare størrelse i beskyttelsen mot overskriving, så en endring med samme størrelse på serveren blir ikke oppdaget.
5. **Etter krasj** kan noen få filer som ble ferdige rett før krasjet, mangle i oversikten. "Fullfør" laster dem opp på nytt (ufarlig). "Angre det som ble gjort" kan da la noen nye filer bli liggende.
6. **Omdøping på servere som ikke lar seg overskrive ved omdøping** løses med slett og så omdøp. Det gir et kort øyeblikk der filen mangler.
7. **Ugyldig JSON** viser ikke alltid linjenummer.
8. **Skjermbilder i "Før og etter"** venter fast 0,7 sekunder etter lasting. Sider med mye animasjon eller treg JavaScript kan bli tatt før de er ferdige.
9. **Grensesnittet er bare testet på norsk og bare på macOS.** Det er ikke laget for Windows eller Linux.
10. **Ingen automatisk oppdatering av appen**, og ingen rapportering av krasj.
11. **Eksportfilen** inneholder mappestier og brukernavn (ikke passord).

---

## 8. Forslag til forbedringer (til diskusjon)

**Trygghet og pålitelighet**
- Lokal SFTP-testserver i testene, og test mot flere typer FTP-servere (vsftpd, ProFTPD, Pure-FTPd, IIS).
- Signering og notarisering hos Apple (krever et Apple-utviklerkonto, ca. 99 USD per år) for enklere installasjon og fullt virkende varsler.
- For servere uten MLSD: last ned og sammenlign filer med samme størrelse før overskriving, som et valg.
- Skriv manifestet etter hver fil i stedet for hvert halve sekund, eller logg hver ferdig fil, så "Angre det som ble gjort" etter krasj blir helt komplett.

**Brukeropplevelse**
- En første omvisning eller hjelpeside i appen.
- Dra og slipp av enkeltfiler, og "gi ut bare denne filen" fra Finder.
- Planlagt utgivelse ("gi ut i kveld kl. 22").
- Bedre "Før og etter": vent til siden er rolig i stedet for fast tid, og marker hvor siden er endret.
- Flere språk i appen.

**For en som lager mange nettsider med AI**
- Maler for nye nettsider, og felles ignorer-regler for alle nettsider.
- Samlet oversikt over alle nettsider: siste utgivelse, sjekkstatus og ventende endringer.
- Varsel hvis den ekte siden slutter å virke (enkel overvåking av oppetid).
- Bildeoptimalisering før opplasting (krympe store bilder).
- Utvidede feilfangere: tilgjengelighet, SEO (meta-beskrivelse), blandet innhold (http på https-side), ødelagte eksterne lenker.

**AI**
- Velg modell (rask og billig mot grundig) i innstillingene.
- La AI forklare et funn eller en feil etter opplasting med vanlige ord, og foreslå en løsning.

---

## 9. Hvor ting ligger

- `README.md`: hva appen er, installasjon, utvikling, bygging, data, alle valg og kjente begrensninger.
- `docs/TESTSJEKKLISTE.md`: manuell testsjekkliste per milepæl, til bruk mot testmappen på webhotellet.
- `docs/PLAN.md`: den opprinnelige planen.
- `release/`: ferdige .dmg-filer (lages med `npm run dist`, ikke lagret i git).

---

## 10. Runde 2: serversjekk, AI-tilkobling og historikk

Runde 2 ble planlagt sammen med en annen AI ut fra denne loggen, og er bygget i ni milepæler. Prinsippene var:
- Macen er fasiten.
- Ingenting slettes uten at brukeren velger det, og lokal sletting går alltid til Papirkurven.
- AI-en kan aldri gjøre mer enn brukeren selv kan i appen, og kan aldri omgå de harde sperrene.

**Tall etter runde 2:** omtrent 15 000 linjer TypeScript i `src`, 274 tester i 34 filer (alle grønne), versjon 0.2.0 (`Skyv-0.2.0-arm64.dmg` og `Skyv-0.2.0-x64.dmg`).

### Del 1: Sjekk av serveren (milepæl 1 og 2)
- "Sjekk serveren" leser fillisten på serveren over én tilkobling og finner tre slags avvik: **mangler på serveren**, **endret på serveren** og **bare på serveren**.
- Hvert avvik har egne valg:
  - Last opp på nytt
  - Slett på Macen også (til Papirkurven)
  - Hent serverens versjon (den gamle havner i Papirkurven)
  - Overskriv med min versjon
  - Hent til Macen
  - La være
- Sjekken kjører av seg selv når du åpner en nettside, hvis det er mer enn 5 minutter siden sist. Det finnes også et valg om bakgrunnssjekk hvert 15. minutt (av som standard).
- Når det finnes avvik, vises ⚠ i sidepanelet og i menylinjen, og en gul linje over "Gi ut".

### Del 2: AI-tilkobling (milepæl 3 til 6)
- **Lokal socket:** Skyv åpner en lokal Unix-socket som bare brukeren kan bruke (0600). Broen `skyv-mcp` (MCP over stdio) lar Claude Code og Claude-appen snakke med Skyv uten API-nøkkel.
- **Tillatelser** sjekkes alltid i hovedprosessen, i denne rekkefølgen: hovedbryter (av som standard), godkjenning av hvert program ("Claude Code vil koble til Skyv. Tillat?"), høyst 60 kall i minuttet, og nivå per nettside.
- **Tre nivåer** per nettside: "Bare se", "Se og klargjøre" og "Se, klargjøre og gi ut".
- **19 verktøy:** status, endringer, sjekker, avvik på serveren, utgivelser, logg, sjekk av den ekte siden, skjermbilder, og verktøy for utkast og notat.
- **Beskyttelse:**
  - Alt innhold fra filer og nettsider er merket som data, ikke instrukser.
  - Linjer som ser ut som passord eller nøkler byttes ut.
  - Kjente passord vaskes bort fra alle svar.
  - Svarene har en størrelsesgrense.
- **Utkast:** AI-en klargjør et utkast med notat. Det vises som et bånd i appen ("Claude Code har klargjort en utgivelse"), der brukeren kan gi ut, se gjennom eller forkaste. Notatet merkes "Skrevet av AI".
- **Felles sperrer:** Både AI-en (på nivå 3) og båndet bruker de samme sperrene. Det blir ingen utgivelse ved:
  - røde funn
  - konflikter
  - avvik på serveren
  - slettinger
  - filer som er endret etter at utkastet ble laget
  - utkast eldre enn 24 timer
- **Angring:** AI-en kan aldri angre selv, bare be om det. Forespørselen vises som et rødt bånd.
- **Innstillingssiden "AI-tilkobling":**
  - kopiérbart oppsett for Claude Code og Claude-appen
  - nivå per nettside
  - tilkoblede programmer med "Koble fra"
  - siste handlinger
  - knapp som installerer kommandolinjen `skyv` (status, changes, check, history, prepare, release, undo) i `~/.local/bin`

### Del 3: AI-arbeidsflyt og historikk (milepæl 7 og 8)
- **Lagrede forskjeller:** Hver utgivelse lagrer en kort tekstforskjell per tekstfil (opptil 200 KB per fil, 50 MB per nettside, eldste ryddes først).
- **Historikk:** "Historikk for denne filen" i appen, og verktøyene `skyv_get_file_history` og `skyv_compare_releases`.
- **Instruksjoner for AI:** Knappen "Legg til Skyv-instruksjoner for AI" skriver en fast arbeidsflyt i `CLAUDE.md` mellom markører, uten å røre resten av filen.
- **Ignorer-listen:** `CLAUDE.md`, `AGENTS.md` og `.claude/` lastes aldri opp, heller ikke for nettsider som fantes fra før.
- **Feil etter opplasting:** Feiler sjekken etter opplasting, får AI-en vite hvilken side og fil, og hva som feilet, både i svaret og i `skyv_get_last_health_check`.

### Milepæl 9: polering og leveranse
- Loggen viser nå hva AI-en gjorde med vanlige ord ("Utført av AI (Claude Code): så på endringene"), ikke verktøynavn.
- README har fått arkitektur og eksempler for AI-tilkoblingen. Testsjekklisten har punkter for hver milepæl.
- Den pakkede appen er prøvd med en ekte MCP-klient gjennom `Skyv.app/Contents/Resources/bin/skyv-mcp`. Klienten så endringer og klargjorde et utkast, og båndet dukket opp. Kommandolinjen ble installert fra appen og svarte på `skyv status`.

### Funnet underveis
- **Kildekode utenfor git:** En regel i `.gitignore` (`release`, ment for byggmappen) traff også `src/core/release`. Koden for utgivelser og angring hadde derfor aldri vært lagret i git. Det er rettet (regelen er nå `/release`), og koden er lagret.

### Kjente begrensninger etter runde 2
- **Bare testet med test-klient:** AI-tilkoblingen er testet med den offisielle MCP-klienten fra Anthropic, men ikke med selve Claude Code eller Claude-appen på denne Macen. Brukeren tester det selv (se `docs/TESTSJEKKLISTE.md`).
- **Intel ikke prøvd:** `.dmg` for Intel er bygget, men ikke prøvd på en Intel-Mac.
- **Eldre FTP-servere:** På servere uten MLSD (eldre FTP) kan serversjekken ikke se endringer som beholder samme størrelse.
- **AI-filer som alt er lastet opp:** Filer for AI som en tidligere versjon har lastet opp, blir liggende på serveren til brukeren sletter dem.
- **Mangler i innstillingene:** Grensen for lagrede forskjeller (50 MB) kan ikke endres i appen ennå.

### Mulige neste steg
- Prøve hele flyten med Claude Code mot testmappen på webhotellet, og justere tekstene i svarene etter hvordan Claude faktisk bruker dem.
- Vise lagrede forskjeller direkte i utgivelseslisten (ikke bare per fil).
- Et varsel når en AI-utgivelse feiler sjekken, med knapp for å be AI-en rette den.
- Signering hos Apple, så installasjonen og varslene blir enklere.
