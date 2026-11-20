# Skyv

Mac-app (Electron + TypeScript + React) som gir ut endringer på nettsider via FTP. Full beskrivelse av hva som skal bygges ligger i prompten jeg ga deg i starten av prosjektet.

## Regler

- Alt brukeren ser i appen skal være på norsk (bokmål), uten fagord som commit, diff, push, hash og manifest.
- Kode og kommentarer skrives på engelsk.
- Kjør testene (`npm run test`) før hver commit. Ikke commit hvis testene feiler.
- Commit etter hver milepæl, med en kort beskrivelse.
- Test aldri mot en ekte FTP-server. Bruk den lokale testserveren i testene. Jeg tester selv mot en testmappe på webhotellet.
- Passord skal aldri ligge i klartekst, i logger eller i feilmeldinger. Bruk macOS-nøkkelringen.
- Aldri slett filer lokalt eller på serveren uten at brukeren har valgt det eksplisitt.
- Hold kjernelogikken i `src/core` ren og testbar, uten Electron-avhengigheter.
- Hold deg til mappen prosjektet ligger i. Ikke endre filer utenfor den.
- Bruk ikke tankestreker (em dash) i tekst som vises til brukeren.

## Arbeidsmåte

- Start hver økt med å lese denne filen og se på siste commits for å finne ut hvor vi er.
- Si fra hvilken milepæl du jobber med, og oppsummer kort når den er ferdig.
- Spør bare hvis du er helt blokkert. Ellers ta et fornuftig valg og skriv det ned i docs/UTVIKLING.md (under "Valg underveis").
