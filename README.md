# Skyv

**Norsk** · [English](#english)

Skyv er en gratis Mac-app som gir ut endringer på nettsidene dine til webhotellet via FTP, FTPS eller SFTP.
Du tenker ikke i filer, men i utgivelser: noe er endret på Macen, du gir det ut, og hver utgivelse kan angres.

Skyv er laget for deg som lager nettsider (HTML, CSS, JavaScript eller PHP), gjerne sammen med en AI, og som vil slippe FileZilla.

- Ingen konto og ingen abonnement.
- Alt skjer på Macen din. Skyv sender ingenting til utvikleren eller andre.
- Passord lagres kryptert i nøkkelringen på Macen.

## Last ned

Gå til [Releases](../../releases/latest) og last ned:

- `Skyv-<versjon>-arm64.dmg` for Mac med Apple-prosessor (M1, M2, M3, M4 …)
- `Skyv-<versjon>-x64.dmg` for Mac med Intel-prosessor

Krever macOS 12 eller nyere.

## Installere

1. Åpne `.dmg`-filen og dra Skyv til **Programmer** (Applications).
2. Åpne Skyv. Fordi appen ikke er godkjent av Apple, sier macOS at den ikke kan bekreftes. Trykk **Done** (eller **OK**).
3. Gå til **Systeminnstillinger → Personvern og sikkerhet** (System Settings → Privacy & Security), bla ned og trykk **Åpne likevel** (Open Anyway) ved Skyv. Bekreft med passordet ditt.
4. Neste gang åpner Skyv seg som vanlig.

PHP er valgfritt. Med PHP installert (for eksempel `brew install php`) får du sjekk av PHP-filer og lokal forhåndsvisning av PHP-sider.

## Hva Skyv gjør

- **Flere nettsider** side om side, med antall endringer som venter.
- **Veiviser for ny nettside:** test av tilkoblingen, automatisk funn av riktig mappe på serveren, og valg av utgangspunkt.
- **Endringsliste:** ny, endret, slettet og omdøpt, med tekstforskjeller linje for linje og bilder før og etter.
- **Utgivelse:** sikkerhetskopi først, midlertidige filnavn, flere tilkoblinger, nye forsøk ved brudd og fullføring etter krasj.
- **Angre** hele utgivelsen eller utvalgte filer.
- **Beskyttelse** mot å overskrive filer som noen andre har endret på serveren.
- **Avhengigheter:** filer som trengs blir tatt med automatisk, og du får varsel om lenker som vil bli ødelagte.
- **Feilfangere før utgivelse:** nøkler og passord, sensitive filer, lokale lenker, plassholdertekst, PHP-feil, ugyldig JSON og mer.
- **Sjekk av den ekte nettsiden** etter opplasting, med angring med ett klikk eller automatisk.
- **Menylinjen:** tall og hurtigutgivelse. Mappene overvåkes i bakgrunnen, endringer grupperes i økter, og du får varsel.
- **Før og etter:** skjermbilder av den ekte siden og din versjon, med lokal forhåndsvisning (også PHP).
- **Notater:** sammendrag på norsk (valgfritt med AI og din egen nøkkel), historikk, logg, og eksport og import av oppsett.
- **Sjekk av serveren:** finner filer som mangler, er endret eller bare finnes på serveren, og lar deg velge hva som skal skje.
- **AI-tilkobling:** Claude Code eller Claude-appen kan se nettsidene, kjøre sjekkene og klargjøre utgivelser som du godkjenner i Skyv. Ingen API-nøkkel trengs.
- **Historikk per fil:** hva som ble endret i hver utgivelse, linje for linje.
- **Kommandolinjen `skyv`:** status, endringer, sjekker og utkast fra Terminal.

## AI-tilkobling (valgfritt)

1. Åpne innstillingene (tannhjulet nederst til venstre), trykk **AI-tilkobling …** og slå den på.
2. Velg nivå for nettsiden: "Bare se", "Se og klargjøre" eller "Se, klargjøre og gi ut".
3. Kopier kommandoen for Claude Code og kjør den i Terminal, for eksempel:

```bash
claude mcp add skyv -- /Applications/Skyv.app/Contents/Resources/bin/skyv-mcp
```

4. Start Claude Code i mappen til nettsiden. Første gang spør Skyv "Claude Code vil koble til Skyv. Tillat?".

Ting du kan be om:

- "Hva er endret i nettsiden?" (bruker `skyv_get_changes`)
- "Kjør sjekkene og rett det du kan." (`skyv_run_checks`)
- "Ta et skjermbilde av forsiden på mobil." (`skyv_screenshot`)
- "Klargjør en utgivelse med et kort notat." (`skyv_prepare_release`, du trykker "Gi ut" i Skyv)
- "Når ble stil.css sist endret?" (`skyv_get_file_history`)
- "Hva var forskjellen på mandagens og fredagens utgivelse?" (`skyv_compare_releases`)
- "Er det noe som er endret på serveren uten at jeg vet om det?" (`skyv_get_server_deviations`)

Kommandolinjen (installeres fra samme side):

```bash
skyv status
```

```bash
skyv changes kafe.no
```

```bash
skyv check
```

```bash
skyv prepare --note "Ny åpningstid på forsiden"
```

Står du i mappen til en nettside, trenger du ikke oppgi navnet. `--json` gir svaret som JSON.

## Hvor data lagres

Alt ligger på Macen din, i `~/Library/Application Support/Skyv/`: oppsettet for nettsidene, historikken, sikkerhetskopier og loggen. Passord ligger kryptert med nøkkelringen. "Fjern fra Skyv" sletter bare Skyvs egne data om nettsiden, aldri filene dine på Macen eller på serveren.

## Kjente begrensninger

- Appen er ikke signert av Apple. Se "Installere" for hvordan du åpner den første gang.
- Knappen "Se gjennom" i varsler kan mangle av samme grunn. Klikk på selve varselet virker.
- SFTP er bygget, men bare FTP og FTPS er testet grundig.
- Ingen automatisk oppdatering. Se etter nye versjoner under Releases.
- Bruk gjerne en testmappe på webhotellet første gang.

## Lisens

Copyright © 2026 Filip Hjelmeland.

Skyv er gratis for ikke-kommersiell bruk under [PolyForm Noncommercial License 1.0.0](LICENSE.md). Du kan bruke appen, og lese og endre koden til eget, ikke-kommersielt bruk. Du kan ikke selge Skyv eller bruke koden i noe kommersielt uten skriftlig tillatelse. Appen leveres som den er, uten garanti.

For utviklere: se [docs/UTVIKLING.md](docs/UTVIKLING.md).

---

## English

Skyv is a free Mac app that publishes changes to your websites via FTP, FTPS or SFTP. You think in releases, not files: something changed on your Mac, you publish it, and every release can be undone.

Highlights:

- **Change list and checks before publishing.** Skyv catches leaked keys and passwords, broken links and PHP errors.
- **Safe publishing.** Every release is backed up first, and you can undo it.
- **Checks after publishing.** Skyv checks the live site, and can find changes made on the server by someone else.
- **Optional AI connection.** Claude Code or the Claude app can look at your sites, run the checks and prepare releases for you to approve. No API key is needed.

No account, no subscription, nothing is sent to the developer. Passwords are stored encrypted in the macOS keychain.

**The app itself is in Norwegian.**

**Download:** see [Releases](../../releases/latest). Use `arm64` for Apple silicon and `x64` for Intel. Requires macOS 12 or later.

**First launch:** the app is not notarized by Apple.
1. Open it once and dismiss the warning.
2. Go to **System Settings → Privacy & Security** and click **Open Anyway** next to Skyv.

**License:** free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Copyright © 2026 Filip Hjelmeland. You may not sell Skyv or use the code commercially without written permission. Provided as is, without warranty.
