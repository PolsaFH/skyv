# Manuell testsjekkliste

Bruk alltid en testmappe på webhotellet, aldri den levende siden.

## Milepæl 1

- [ ] `npm run dev` åpner vinduet med sidepanel og teksten "Dra en mappe hit for å komme i gang".
- [ ] Lys og mørk modus ser riktige ut (bytt i Systeminnstillinger).
- [ ] Dra en mappe inn i vinduet: veiviseren åpnes med navn foreslått fra mappenavnet.
- [ ] Dra en fil (ikke mappe) inn: vennlig melding om at det må være en mappe.
- [ ] "+ Ny nettside" åpner mappevelgeren.
- [ ] Lagre med passord: sidepanelet viser nettsiden, og "Passord: Lagret i nøkkelringen".
- [ ] Sjekk at `~/Library/Application Support/Skyv/sites.json` ikke inneholder passordet.
- [ ] Åpne innstillinger, la passordfeltet stå tomt, lagre: passordet er fortsatt lagret.
- [ ] Legg til samme mappe to ganger: vennlig melding.
- [ ] "Vis i Finder", "Åpne nettsiden" og "Kopiér lenke" virker.
- [ ] "Fjern fra Skyv" viser oversikt over hva som skjer og ikke skjer. Etterpå ligger mappen på Macen urørt.
- [ ] Piltastene flytter valget i sidepanelet. Escape lukker dialoger.
- [ ] Avslutt og start appen på nytt: nettsidene er der fortsatt.

## Milepæl 2

Bruk FTP-kontoen til en testmappe på webhotellet.

- [ ] Veiviseren viser fem steg. "Neste" er ikke mulig før steget er fylt ut.
- [ ] Feil passord: "Brukernavn eller passord ser ut til å være feil" med forslag.
- [ ] Feil vertsnavn (for eksempel ftp.finnesikke.no): "Fant ikke serveren".
- [ ] Feil port: "Serveren svarte ikke på port …".
- [ ] FTPS mot en server som ikke støtter det: forklaring og forslag om vanlig FTP.
- [ ] Riktige opplysninger: "Tilkoblingen virker".
- [ ] Steg 3 foreslår riktig mappe (for eksempel `/public_html` eller testmappen) med begrunnelse.
- [ ] "Bla gjennom serveren" lar deg gå inn i mapper, opp en mappe, og velge "Bruk denne mappen".
- [ ] Nettadresse foreslås fra navnet hvis navnet ser ut som et domene.
- [ ] Alle tre valg for utgangspunkt kan velges. "Last opp alt" viser advarsel om at filer erstattes.
- [ ] Etter "Legg til nettside" vises nettsiden med valgt mappe på serveren og utgangspunkt.
- [ ] Innstillinger: "Test tilkobling" virker med lagret passord (tomt passordfelt).
- [ ] SFTP (hvis webhotellet tilbyr det): tilkobling virker, og serverens identitet huskes.

## PHP

- [ ] Åpne Skyv fra Finder (ikke fra Terminal). Innstillingene for en nettside viser "PHP er funnet" med versjon.
- [ ] Uten PHP (eller med PHP midlertidig flyttet): innstillingene sier at PHP ikke ble funnet, og ingenting annet feiler.

## Milepæl 3

- [ ] Ny nettside med "Ja, start herfra": viser "Alt er oppdatert" med tidspunkt.
- [ ] Endre en HTML-fil, legg til et bilde, gi nytt navn til en CSS-fil og slett en fil. Bytt til et annet program og tilbake: listen viser ny, endret, omdøpt og slettet.
- [ ] Slettet fil er rød, gjennomstreket og ikke avkrysset. Antallet på knappen stemmer.
- [ ] Klikk på en endret HTML-fil: linjer som er fjernet er røde, nye er grønne, med linjenummer.
- [ ] Klikk på et endret bilde: "Før" (hentet fra serveren) og "Etter" vises side om side.
- [ ] Søk og filterknappene (Alle, Nye, Endret, Omdøpt, Slettet) virker.
- [ ] Sidepanelet viser antall ventende endringer.
- [ ] Lag `.env`, `.DS_Store` og en `node_modules`-mappe: de dukker ikke opp.
- [ ] Legg til en egen ignorer-regel i innstillingene (for eksempel `utkast/`): filene i mappen forsvinner fra listen.
- [ ] Skriv en regel med `..`: vennlig melding, og "Lagre" er ikke mulig.
- [ ] Ny nettside med "Sammenlign med serveren" mot testmappen: "Rask sjekk" og "Grundig sjekk" gir oppsummering. Filer som er forskjellige vises som "endret", og "Hent forrige versjon fra serveren" viser forskjellen.
- [ ] En mappe med flere tusen filer: vinduet fryser ikke mens den skannes, og fremdrift vises.

## Milepæl 4

Bruk alltid testmappen på webhotellet.

- [ ] Gjør noen endringer og trykk "Gi ut N endringer" (eller ⌘ Enter). Fremdrift vises per fil og totalt.
- [ ] Etter utgivelsen: åpne nettsiden i nettleseren og se at endringene er der.
- [ ] Kryss av en slettet fil: en egen bekreftelse lister opp filene som slettes.
- [ ] Mens en stor fil lastes opp: se i FileZilla at den ligger som `.navn.xxxxxxxx.skyvtmp` og først får riktig navn når den er ferdig.
- [ ] Slå av Wi-Fi midt i en utgivelse og slå det på igjen innen noen sekunder: utgivelsen fortsetter.
- [ ] Slå av Wi-Fi lenge: filene som ikke kom ut vises i rødt med forklaring. "Prøv igjen" fullfører når nettet er tilbake.
- [ ] Tvangsavslutt Skyv midt i en stor opplasting (⌥⌘⎋). Start igjen: "En utgivelse ble avbrutt" med Fullfør, Angre og Ikke gjør noe.
- [ ] "Tidligere utgivelser": listen viser tidspunkt, antall filer og status.
- [ ] "Angre" viser hva som får tilbake forrige versjon og hva som fjernes. Etterpå er nettsiden som før, og endringene står i listen igjen.
- [ ] Åpne en utgivelse i historikken, kryss av én fil og "Angre valgte filer": bare den filen settes tilbake.
- [ ] Lag mer enn 20 utgivelser: de eldste kan ikke angres lenger, med forklaring.

## Milepæl 5

- [ ] Gi ut en endring. Rediger samme fil direkte på serveren (i FileZilla eller webhotellets filbehandler). Endre den på Macen også, og trykk "Gi ut": dialogen "1 fil er endret på serveren" vises.
- [ ] "Vis forskjell" viser serverens versjon mot din. "Hopp over" er valgt som standard.
- [ ] "Behold min versjon": din versjon legges ut, og sikkerhetskopien gjør at du kan angre.
- [ ] Legg et nytt bilde i mappen og bruk det i index.html: bildet merkes "Trengs av index.html".
- [ ] Fjern krysset for bildet: merkelappen blir gul, og en advarsel sier at det brukes av index.html.
- [ ] Skriv en lenke til en fil som ikke finnes: advarsel med filnavn og linjenummer.
- [ ] Skriv `Bilder/Logo.png` når filen heter `bilder/logo.png`: advarsel om store og små bokstaver.
- [ ] Bruk et bilde som ligger i en ignorert mappe: advarsel om at filen aldri lastes opp.

## Milepæl 6

- [ ] Lim inn en (falsk) nøkkel som `sk-ant-...` i en JS-fil: rødt funn, nøkkelen vises bare delvis, og knappen er låst til du krysser av.
- [ ] Lag en `config.php` med `define('DB_PASSWORD', 'noe');`: rødt funn. "Ignorer dette funnet": det forsvinner, også etter "Oppdater".
- [ ] Legg en `.zip` eller `.sql` i mappen: rødt funn om sensitiv fil.
- [ ] Lenke til `http://localhost:3000`: gul advarsel med linjenummer.
- [ ] "Lorem ipsum", "TODO" eller "test123" i en side: gul advarsel.
- [ ] PHP-fil med syntaksfeil (for eksempel manglende semikolon): gul advarsel med linjenummer.
- [ ] Ødelagt JSON-fil: gul advarsel.
- [ ] Slett mer enn 10 filer og kryss av: advarsel om uvanlig mange slettinger.
- [ ] Bilde uten alt-tekst, side uten `<title>` og `console.log` i JS: blå tips.
- [ ] "Vis igjen" henter tilbake ignorerte funn.

## Milepæl 7

Bruk testmappen, og sett "Nettadresse" til adressen der testmappen kan åpnes i nettleseren.

- [ ] Gi ut en vanlig endring: "Nettsiden svarer som den skal", med antall sider og filer som ble sjekket.
- [ ] Endre bare en include (for eksempel `inc/meny.php`): sidene som bruker den, blir sjekket.
- [ ] Gi ut en PHP-fil som kaller en funksjon som ikke finnes: rødt varsel "Noe ser feil ut på siden din" med en kort forklaring.
- [ ] Trykk "Angre utgivelsen" i det røde varselet: den forrige versjonen ligger ute igjen med en gang.
- [ ] Endre en side så den peker på et bilde som ikke finnes: varselet sier hvilket bilde.
- [ ] Slå på "Angre automatisk hvis sjekken feiler" og gi ut noe som er feil: Skyv angrer selv og forklarer hvorfor.
- [ ] Nettside uten nettadresse: sjekken hoppes over med forklaring.
- [ ] Historikken viser resultatet av sjekken for hver utgivelse.

## Milepæl 8

- [ ] Skyv-ikonet (pil opp) vises i menylinjen, med antall endringer ved siden av når noe venter.
- [ ] Klikk på ikonet: liten oversikt med alle nettsider, antall og "Gi ut".
- [ ] "Gi ut" i oversikten med vanlige endringer: "✓ Utgitt." Sjekk nettsiden.
- [ ] "Gi ut" når en fil har en nøkkel eller et passord: Skyv sender deg til hovedvinduet i stedet.
- [ ] Høyreklikk på ikonet: Åpne Skyv, Innstillinger og Avslutt.
- [ ] La en AI (eller deg selv) endre flere filer i mappen mens Skyv er i bakgrunnen. Etter cirka 8 sekunder i ro kommer varselet "N filer endret i … Klar til å gis ut?". Klikk åpner nettsiden.
- [ ] Listen i hovedvinduet oppdateres av seg selv, og filene har merkelappen "Økt hh:mm".
- [ ] Lukk vinduet: Skyv fortsetter i menylinjen. Slå av "Fortsett i bakgrunnen": nå avslutter Skyv når vinduet lukkes.
- [ ] Skjul Dock-ikonet: Skyv finnes fortsatt i menylinjen.
- [ ] Bytt "Tallet i menylinjen viser" til "nettsiden som er valgt": tallet følger nettsiden du har åpen.
- [ ] (Installert app) "Start Skyv når du logger inn": Skyv starter i menylinjen etter ny innlogging.

## Milepæl 9

- [ ] Endre en side (for eksempel farge eller tekst) og trykk "Før og etter": den ekte siden og din versjon vises side ved side.
- [ ] "Glidebryter": dra i håndtaket eller bruk glidebryteren under. Før vises til venstre, etter til høyre.
- [ ] "Mobil": begge bildene tas på nytt i mobilbredde.
- [ ] Endre bare en CSS-fil: sidene som bruker den, står i listen over sider.
- [ ] Nettside med PHP: den lokale versjonen kjøres med PHP (en melding nederst sier det).
- [ ] "Åpne lokal forhåndsvisning i nettleseren" åpner siden fra Macen i nettleseren. Prøv å legge `/.env` til adressen: den skal ikke vises.
- [ ] "Åpne den ekte siden" åpner nettsiden.
- [ ] Nettside uten nettadresse: bare din versjon vises, med forklaring.

## Milepæl 10

- [ ] Gjør noen endringer: "Notat for utgivelsen" viser for eksempel "Endret 1 HTML-side, la til 1 bilde.". Fjern krysset for en fil: notatet endrer seg.
- [ ] Skriv ditt eget notat og gi ut: notatet vises i "Tidligere utgivelser". "Rediger" lar deg endre det.
- [ ] "Vis logg": utgivelser, angring, sjekker og endringer i innstillinger står der. Passordet står ikke noe sted. "Kopier logg" virker.
- [ ] ⚙ → "Eksporter nettsider …": åpne filen og se at passord ikke er med.
- [ ] På en annen Mac (eller etter å ha fjernet en nettside): "Importer nettsider …". Nettsiden kommer tilbake uten passord.
- [ ] (Valgfritt, koster litt) Legg inn din egen API-nøkkel fra Anthropic og slå på "Skriv sammendrag med AI". Første "Skriv med AI" viser hva som sendes. Etter "Send og skriv sammendrag" står et kort notat på norsk i feltet.
- [ ] Med en (falsk) nøkkel i en JS-fil: "Vis hva som sendes" viser at innholdet i filen ikke sendes.
- [ ] Slå av AI eller fjern nøkkelen: knappen forsvinner, og alt annet virker som før.

## Milepæl 11 (installert app)

- [ ] Åpne riktig .dmg (arm64 for Apple-prosessor, x64 for Intel) og dra Skyv til Programmer.
- [ ] Første start: høyreklikk → Åpne (eller "Åpne likevel" i Personvern og sikkerhet). Skyv-ikonet (blå med pil opp) vises i Dock.
- [ ] Åpnet fra Finder: innstillingene for en nettside viser at PHP er funnet (hvis PHP er installert).
- [ ] Mappe med flere tusen filer: listen kommer raskt, og "Vis flere" vises under de første 400.
- [ ] Mørk og lys modus (Systeminnstillinger → Utseende): alt er lesbart i begge.
- [ ] Hele løypa mot testmappen: ny nettside, endre, gi ut, sjekk nettsiden, angre.

## Runde 2, milepæl 2: Serversjekk

Bruk testmappen på webhotellet og FileZilla.

- [ ] Åpne en nettside: "Serveren stemmer med Skyv" og "Sjekket akkurat nå" (sjekken kjører av seg selv første gang).
- [ ] Slett en fil på serveren i FileZilla, og trykk "Sjekk serveren": filen står under "Mangler på serveren". Bruker en side den, står det i rødt.
- [ ] Velg "Last opp på nytt": utgivelsen kjører som vanlig, og filen ligger på serveren igjen.
- [ ] Endre en fil på serveren (gjør den lengre eller kortere). Den står under "Endret på serveren". "Vis forskjell" viser serverens versjon mot din.
- [ ] "Hent serverens versjon til Macen": bekreft. Filen på Macen er nå serverens versjon, og den gamle ligger i Papirkurven.
- [ ] Endre en fil på serveren igjen, og velg "Overskriv med min versjon": filen står i endringslisten, og neste "Gi ut" legger din versjon ut uten at konfliktdialogen spør.
- [ ] Legg en ny fil på serveren: "Bare på serveren". Prøv både "Hent til Macen" og "La være" (den vises ikke igjen).
- [ ] Slett en fil på serveren og velg "Slett den på Macen også …": filen ligger i Papirkurven, ikke slettet for godt.
- [ ] Mens det finnes avvik: ⚠ i sidepanelet og i menylinjen, og en gul linje over "Gi ut". Knappen virker likevel.
- [ ] Hvis webhotellet ikke oppgir nøyaktig endringstid, står det en forklaring om at endringer med lik størrelse ikke kan oppdages.
- [ ] Slå på "Sjekk serveren i bakgrunnen hvert 15. minutt" i innstillingene, endre noe i FileZilla og vent: avviket dukker opp av seg selv.

## Runde 2, milepæl 6: AI-tilkobling

- [ ] Åpne innstillingene, trykk "AI-tilkobling …" og slå den på. Sett nettsiden til "Se og klargjøre".
- [ ] Kopier kommandoen for Claude Code og kjør den i Terminal. Start Claude Code i nettsidens mappe.
- [ ] Spør "Hva er endret i nettsiden?": Skyv spør "Claude Code vil koble til Skyv. Tillat?". Tillat, og svaret lister endringene.
- [ ] Be Claude Code klargjøre en utgivelse: et utkastbånd dukker opp i Skyv med notatet merket "Skrevet av AI". Trykk "Gi ut", og sjekk at filene ligger på serveren.
- [ ] Trykk "Installer kommandolinjen", følg eventuelt PATH-hintet, og kjør `skyv status` i en ny Terminal. Godkjenn "Skyv kommandolinje".
- [ ] "Koble fra" fjerner programmet fra listen, og neste gang spør Skyv på nytt.
- [ ] Slå av AI-tilkoblingen: Claude Code får beskjed om at tilkoblingen er slått av.

## Runde 2, milepæl 7: Historikk

- [ ] Endre `stil.css` to ganger og gi ut hver gang med et notat.
- [ ] Åpne "Tidligere utgivelser", åpne den nyeste og klikk på `stil.css`: "Historikk for denne filen" viser begge utgivelsene med notat, og forskjellen linje for linje.
- [ ] Klikk på et bilde i en utgivelse: historikken forklarer at bare navnet er lagret.
- [ ] En utgivelse fra før denne versjonen viser forklaringen "fra før Skyv lagret forskjeller".
- [ ] Spør Claude Code "Når ble stil.css sist endret?" og "Hva var forskjellen på de to siste utgivelsene?". Svarene stemmer med historikken i appen.

## Runde 2, milepæl 8: Instruksjoner for AI og sjekken etter opplasting

- [ ] Skriv noen egne linjer i `CLAUDE.md` i nettsidens mappe. Åpne innstillingene for nettsiden og trykk "Legg til Skyv-instruksjoner for AI": dine linjer står igjen, og Skyvs del ligger under.
- [ ] Trykk "Oppdater Skyv-instruksjonene": fortsatt bare én Skyv-del.
- [ ] Trykk "Fjern Skyv-instruksjonene": bare dine egne linjer står igjen.
- [ ] Gi ut en endring mens `CLAUDE.md`, `AGENTS.md` og en `.claude`-mappe ligger i nettsidens mappe: ingen av dem står i endringslisten, og ingen av dem havner på serveren (sjekk i FileZilla).
- [ ] Med nettadressen satt og nivå 3: be Claude Code gi ut en side med en feil (for eksempel et bilde som ikke finnes på serveren). Claude Code får vite hva som feilet og foreslår å rette det og klargjøre en ny utgivelse.

## Runde 2, milepæl 9: Ny versjon (0.2.0)

- [ ] Installer `Skyv-0.2.0-arm64.dmg` over den gamle versjonen. Nettsidene, historikken og passordene er der fortsatt.
- [ ] Kopier kommandoen for Claude Code fra "AI-tilkobling". Den peker på `/Applications/Skyv.app/Contents/Resources/bin/skyv-mcp`.
- [ ] Gå gjennom punktene for runde 2 over mot testmappen på webhotellet: serversjekk med FileZilla, AI-tilkobling med Claude Code, historikk og instruksjoner i CLAUDE.md.
- [ ] Loggen ("Vis logg") viser hva AI-en gjorde med vanlige ord, for eksempel "så på endringene".
