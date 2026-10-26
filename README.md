# Agenda

Een agenda-app in Apple Agenda-stijl, gebouwd met Electron en Tailwind CSS (geen frameworks). Licht en donker thema volgen het systeem, de zijbalk is op macOS doorschijnend.

## Vereisten

- [Node.js](https://nodejs.org/) (en npm)

## Installeren en starten

```bash
npm install
npm start
```

Als het Electron-binary na `npm install` ontbreekt (er is dan geen `node_modules/electron/path.txt`), download je het handmatig met `node node_modules/electron/install.js`.

De code is TypeScript. `npm start` bouwt eerst alles naar `dist/` (`tsc` voor de TypeScript, daarna `index.html` kopiëren en de CSS door Tailwind). Tijdens het werken aan de opmaak draai je in een tweede terminal `npm run watch:css`. Types controleren zonder te bouwen: `npm run typecheck`. Tests: zie [Testen](#testen).

## Functies

**Weergaven**: dag, week, maand, jaar en lijst ("Binnenkort"), met weeknummers (optioneel), de eerste dag van de week naar keuze en een 24- of 12-uursklok.

**Afspraken**: titel, locatie, begin en einde (ook meerdere dagen), hele dag, tijdzone, herhalen (elke dag, werkdag, week, om de week, maand, jaar, met einddatum), melding, reistijd, genodigden, URL en notitie.

**Invoer**
- **+** of ⌘N opent snel invoeren in gewone taal: `Lunch met Sam morgen 12:30`, `Yoga elke dinsdag 19:00 @Studio #werk`, `Workshop 3 november van 10:00 tot 12:30`. "Meer opties…" opent het volledige formulier.
- **⌘K** opent het commandopalet: een opdracht uitvoeren (`weergave week`), naar een datum springen (`ga naar 3 november`), een afspraak zoeken en openen, of in gewone taal een afspraak maken (`Tandarts vrijdag 14:00`).
- Zoeken (⌘F) toont terwijl je typt de beste resultaten in een uitklaplijst met de gevonden letters gemarkeerd; Enter toont alle resultaten als lijst.
- In het uurraster: dubbelklik of sleep over een leeg stuk en typ de titel meteen in het blok (Enter bewaart, Escape annuleert, ⌘/Ctrl+Enter opent het volledige formulier). In de maand en de hele-dag-rij maakt slepen over meerdere dagen een meerdaagse afspraak.
- Een afspraak kopiëren of plakken: rechtermuisknop op de afspraak en op een lege plek in een dag (in het uurraster plakt dat op het aangeklikte tijdstip), of ⌘C / ⌘V. Een bestand of agenda-link (.ics, webcal://) op het venster laten vallen importeert of voegt toe.

**Met de muis aanpassen**
- Sleep een afspraak naar een andere dag of tijd, naar een dag in de minikalender, of op een agenda in de zijbalk om hem daarheen te verplaatsen. Sleep de onderrand om hem te verlengen; bij een meerdaagse balk de linker- of rechterrand. Houd **Alt/⌥** ingedrukt bij het loslaten om te kopiëren (een kopie is een losse afspraak zonder herhaling). Bij herhalende afspraken vraagt de app: alleen deze, deze en alle volgende, of alle.
- Een label naast de cursor toont tijdens het slepen de dag en tijd; aan de rand van het uurraster scrolt het vanzelf mee.
- **⇧-klik of ⌘-klik** (Windows/Linux ook Ctrl) telt afspraken bij de selectie op, **⌘A** selecteert alles wat te zien is. De hele selectie kun je samen verplaatsen, kopiëren (Alt), plakken, dupliceren en verwijderen, in één stap.
- Een afspraak aanklikken selecteert hem; nog een keer klikken (of de spatie) opent een kaartje met snelle acties: bewerken, dupliceren, kopiëren, verwijderen en een andere agenda kiezen. Bij hover verschijnt na een halve seconde een voorbeeld. "3 meer…" in de maand toont alle afspraken van die dag in een lijstje.
- Na elke wijziging verschijnt onderaan een melding met **Ongedaan maken**. Afspraken glijden naar hun nieuwe plek in plaats van te springen.

**Toetsenbord en trackpad**
- Pijltjestoetsen: zonder selectie een dag (←/→) of week (↑/↓) verder; met een afspraak geselecteerd naar de dichtstbijzijnde afspraak in die richting. Enter opent de afspraak, de spatie zijn kaartje, Delete verwijdert.
- Twee vingers horizontaal vegen gaat naar de vorige/volgende periode; knijpen (of ⌘/Ctrl + scrollen) in het uurraster maakt de uren hoger of lager, ook met *Weergave → Uren groter/kleiner* (⌘+ / ⌘−, ⌘0 zet terug). De hoogte wordt onthouden. *Vandaag* scrolt het uurraster zacht naar het huidige tijdstip.

**Externe agenda's** (Bestand → *Agenda-account of link toevoegen…*, of de **+** naast Agenda's)
- **Google Agenda** en **Outlook / Microsoft 365**: plak de geheime iCal-link (Google: Instellingen → agenda → "Geheim adres in iCal-indeling"; Outlook op het web: Instellingen → Agenda → Gedeelde agenda's → "Een agenda publiceren" → ICS). Alleen-lezen. Inloggen met OAuth is bewust niet gebouwd: dat vraagt een eigen geregistreerde app bij Google/Microsoft.
- **iCloud** en andere **CalDAV-servers** (Nextcloud, Fastmail, …): inloggen met Apple ID + *app-specifiek wachtwoord* (appleid.apple.com), of server + gebruikersnaam + wachtwoord. Alleen-lezen. Het wachtwoord wordt met de sleutelhanger van het systeem versleuteld (`accounts.json` in de `userData`-map) en gaat nooit terug naar de pagina; zonder beschikbare sleutelhanger wordt er niet ingelogd.
- **Elke andere agenda** via een `.ics`- of `webcal://`-link.
- Ze verversen bij het opstarten en daarna automatisch; hoe vaak stel je in bij *Voorkeuren → Automatisch vernieuwen* (uit, 5, 15, 30 (standaard), 60 minuten of 3 uur). Altijd meteen vernieuwen kan met de knop ⟳ bovenin, ⌘R (*Vernieuw externe agenda's*) of rechtermuisknop → *Vernieuw*; de knop draait zolang er wordt opgehaald. Mislukt het, dan blijven de oude afspraken staan en toont de zijbalk een ⚠.
- Afspraken uit een externe agenda kun je bekijken, kopiëren en dupliceren (naar een eigen agenda), maar niet bewerken, slepen of verwijderen: de volgende synchronisatie zou dat toch overschrijven. Je kunt een externe agenda wel hernoemen, een andere kleur geven of verwijderen.
- Beperkingen: herhalingen worden ondersteund per dag, week (ook op meerdere weekdagen), maand (op dezelfde datum) en jaar; "tweede dinsdag van de maand" en vergelijkbare regels worden als gewone maandelijkse herhaling getoond. De echte iCloud-server is niet getest (alleen tegen een nagebootste CalDAV-server).

**Overig**
- Zoeken (⌘F) in titel, locatie, notitie en genodigden.
- Selecteren, knippen, kopiëren, plakken, dupliceren, verwijderen (⌫) en ongedaan maken/opnieuw (⌘Z / ⇧⌘Z); rechtermuisknop op een afspraak geeft een menu.
- Importeren en exporteren als `.ics` (Bestand-menu, of per agenda via rechtermuisknop).
- Meldingen als macOS-notificatie zolang de app geopend is, en een Dock-icoon met de datum van vandaag.
- Sneltoetsen: ⌘1 t/m ⌘5 weergave, ⌘T vandaag, ⌘← / ⌘→ vorige/volgende, ⌘, voorkeuren, ⌥⌘N nieuwe agenda.

**Meldingen**: een melding verschijnt als kaart in de app (met *Over 5 min* en *Over 1 uur* uitstellen; een uitgestelde melding overleeft een herstart) of, als de app niet voorop staat, als melding van het systeem (op macOS met een uitstelknop van 10 minuten). Heeft een afspraak reistijd én een melding, dan komt er ook een melding op het moment dat je moet **vertrekken**.

**Taken**: zet bij een afspraak *Taak* aan (of ⌘K → *Nieuwe taak*). Een taak heeft een rondje dat je aanklikt om hem af te vinken (bij een herhalende taak per dag); afgevinkte taken geven geen melding meer. Ook via rechtermuisknop → *Markeer als gedaan*. Taken worden bij het exporteren als gewone afspraken opgenomen.

**Sjablonen**: *Bewaar als sjabloon* in een afspraak bewaart naam, tijd, duur, agenda, locatie, herhaling, enz. Maak hem later met ⌘K → *Sjabloon: …* op de gekozen dag. Beheren onder *Voorkeuren → Sjablonen*.

**Selecteren met een kader**: houd **⇧** ingedrukt en sleep over een lege plek (maand, dag, week); alles wat in het kader valt wordt geselecteerd. **⇧⌘** vult de selectie aan. Zonder ⇧ maakt slepen nog steeds een nieuwe (meerdaagse) afspraak.

**Overlap oplossen**: overlapt een afspraak met een andere, dan staat er *Zoek een vrij moment*; dat zet hem op het eerstvolgende gat van dezelfde lengte (08:00–21:00, de komende twee weken).

**Statistieken**: ⌘K → *Statistieken…* toont uren per agenda en per weekdag, de drukste dag en open/afgevinkte taken, voor deze of vorige week of maand.

**Weer**: onder *Voorkeuren → Weer* kies je een plaats; daarna staan de verwachting (icoon en maximumtemperatuur, 14 dagen vooruit) bij de dagen in de maand-, week- en dagweergave. Dit gebruikt open-meteo.com (gratis, geen account); alleen de plaatsnaam en de coördinaten gaan naar buiten. Staat standaard uit.

**Extra tijdzones**: onder *Voorkeuren → Extra tijdzones* kies je er maximaal twee; de klok in die zone staat dan naast het uurraster van de dag- en weekweergave (met +1/−1 bij een andere dag).

**Menubalk en sneltoets**: onder *Voorkeuren → Menubalk en sneltoets* zet je een icoon in de menubalk aan met de eerstvolgende afspraken (op macOS ook "Tandarts · over 12 min" naast het icoon), en stel je een globale sneltoets in om overal snel een afspraak te maken.

**Uitnodigen**: in een afspraak opent *Uitnodiging mailen…* je mail-app met een ingevulde uitnodiging voor de genodigden met een e-mailadres, en *Bewaar als .ics…* bewaart de afspraak als bijlage-bestand. Er wordt niets automatisch verstuurd en antwoorden (RSVP) worden niet bijgehouden: dat zou een mailkoppeling vragen.

**Back-ups**: de app bewaart automatisch kopieën van je agenda (maximaal 20, hooguit één per half uur) in de map `backups`. Onder *Voorkeuren → Back-ups* zet je een eerdere versie terug; de huidige stand wordt dan eerst als back-up bewaard.

**Beweging**: weergaven zoomen in of uit bij het wisselen, afspraken landen met een kleine veer, verwijderde afspraken krimpen weg, de "nu"-bol pulseert zacht en de melding met *Ongedaan maken* toont een voortgangsbalk. Met "minder beweging" in de systeeminstellingen staat dit uit.

Genodigden worden alleen bewaard; de app verstuurt zelf niets.

## Assistent in de app (eigen API-sleutel)

De knop ✦ bovenin (of ⌘K → *Vraag het aan Claude…*) opent een zijpaneel om met Claude over je agenda te praten: "Plan elke dinsdag 18:00 hardlopen tot eind december" of "Wanneer ben ik volgende week vrij voor 1,5 uur?". Dit gebruikt een **eigen API-sleutel** van Anthropic (console.anthropic.com; apart van een Claude-abonnement, je betaalt per gebruik). De sleutel wordt met de sleutelhanger van het systeem versleuteld bewaard en komt nooit in de pagina. Kies het model bovenin het paneel (Opus 5.5, Sonnet 5.5 of Haiku 5.5). Claude gebruikt dezelfde acht tools als de MCP-server en dezelfde privacy-instellingen (wijzigen, notities, genodigden); wijzigingen verschijnen direct in de agenda met *Ongedaan maken*. Wat Claude uit je agenda leest gaat naar Anthropic.

## Claude gebruiken met je agenda (MCP)

Claude Desktop of Claude Code (met je gewone Claude-abonnement, geen API-sleutel nodig; de chat in de app hierboven gebruikt wél een API-sleutel) kan je agenda lezen en beheren via een MCP-server die in deze app zit. Claude ziet dan de volledige context: wat er staat, wanneer je vrij bent, en kan afspraken maken, verzetten en verwijderen.

**Koppelen**
1. Open de app en ga naar *Voorkeuren → Claude*.
2. Klik *Voeg toe aan Claude Desktop* (er verschijnt eerst een bevestiging; een bestaand configuratiebestand wordt eerst gekopieerd naar `…agenda-backup`) en start Claude Desktop opnieuw op. Voor Claude Code: *Kopieer opdracht voor Claude Code* en plak die in een terminal.
3. Vraag bijvoorbeeld: “Wat staat er volgende week in mijn agenda?” of “Plan elke dinsdag 18:00 hardlopen tot eind december.”

**Hoe het werkt**: de app moet draaien; Claude start een klein proces (de app zelf als Node, `dist/mcp.js`) dat via een lokale socket (alleen voor jouw gebruiker, met een geheim dat bij elke start wisselt) met de draaiende app praat. Wijzigingen lopen door dezelfde code als je eigen acties: je ziet ze meteen, met een melding “Claude: …” en *Ongedaan maken*. Zonder draaiende app meldt Claude dat de app gestart moet worden.

**Tools**: `get_context`, `list_events`, `search_events`, `get_event`, `find_free_time` (lezen) en `create_events`, `update_event`, `delete_event` (schrijven; herhalingen met “alleen deze / alle / deze en volgende”).

**Privacy**: in *Voorkeuren → Claude* kun je wijzigen, notities en genodigden afzonderlijk uitzetten. Dit wordt in de app afgedwongen, niet aan Claude overgelaten. Alleen-lezen agenda’s (feestdagen, gekoppelde links en accounts) kan Claude niet wijzigen. Let op: wat Claude leest, wordt naar Anthropic gestuurd zodra je Claude ernaar vraagt.

## Opslag

Alles staat in `events.json` in de `userData`-map van de app (op macOS `~/Library/Application Support/electron-begin/`):

```json
{
  "version": 2,
  "calendars": [{ "id": "home", "name": "Privé", "color": "blue", "visible": true, "type": "user" }],
  "events": [{ "id": "uuid", "calendarId": "home", "title": "Tandarts", "date": "2026-10-28", "endDate": "2026-10-28",
               "time": "14:30", "endTime": "15:30", "location": "", "url": "", "notes": "",
               "repeat": { "freq": "weekly", "interval": 1, "until": "" }, "alert": 15, "travel": 0,
               "invitees": [], "tz": "", "exceptions": [] }],
  "settings": { "weekStart": 1, "clock24": true, "weekNumbers": false, "defaultAlert": null }
}
```

Het oude formaat (een array met afspraken en een kleur) wordt bij het laden omgezet. Is het bestand kapot of ontbreekt het, dan start de app met lege standaardagenda's.

## Projectstructuur

```
package.json
tsconfig.*.json    # base, main (main + preload, CommonJS), renderer (src/js, ES-modules), test
scripts/           # copy-static.mjs: kopieert index.html naar dist/
src/
  net.ts         # netwerk voor externe agenda's (feeds ophalen), draait in main
  caldav.ts      # CalDAV-client (alleen lezen) voor iCloud e.d.
  accounts.ts    # agenda-accounts met versleuteld wachtwoord
  main.ts        # venster (macOS: vibrancy), menubalk, opslag, meldingen, Dock-icoon, ics-dialogen
  preload.ts     # veilige brug naar de pagina (contextBridge)
  index.html     # zijbalk, werkbalk en dialogen, met Content-Security-Policy
  input.css      # Tailwind-invoer: kleurthema (licht/donker, agendakleuren)
  shared/
    types.ts     # datamodel en de API die preload aan de pagina geeft (alleen types)
  js/
    app.ts         # werkbalk, menu-acties, sneltoetsen, meldingen, Dock-icoon
    state.ts       # gedeelde data, weergave-toestand en haken tussen modules
    store.ts       # laden/opslaan, ongedaan maken, alle wijzigingen
    model.ts       # datamodel, migratie, bewerken/verwijderen met bereik   (getest)
    occurrences.ts # herhalingen, meerdaagse afspraken, tijdzones, feestdagen (getest)
    holidays.ts    # Nederlandse feestdagen (Pasen e.d.)
    alerts.ts      # welke meldingen wanneer afgaan                          (getest)
    search.ts      # zoeken                                                  (getest)
    ics.ts         # .ics import/export                                      (getest)
    quick.ts       # invoer in gewone taal                                   (getest)
    flip.ts        # glij-animatie van afspraken bij wijzigingen
    popover.ts     # hover-voorbeeld, kaartje met acties en de dagenlijst bij "N meer…"
    dragkit.ts     # sleeplabel en automatisch scrollen
    gestures.ts    # veegt en knijpen op het trackpad
    keynav.ts      # pijltjesbesturing door afspraken
    palette.ts     # commandopalet (⌘K)
    searchpop.ts   # uitklaplijst bij het zoeken
    dropzone.ts    # bestanden en links op het venster laten vallen
    sync.ts        # externe agenda's ophalen, inlezen en periodiek verversen
    sources.ts     # dialoog "Agenda toevoegen"
    month.ts, timegrid.ts, year.ts, list.ts, sidebar.ts, dialogs.ts, occ-ui.ts, format.ts, colors.ts, util.ts
    globals.d.ts   # window.agenda voor de renderer
tests/
  unit/          # Vitest: logic/ (pure logica), main/ (main + preload, gemockte electron), renderer/ (jsdom)
  e2e/           # Playwright tegen de gebouwde app (dist/)
eslint.config.mjs, .prettierrc.json, vitest.config.mts, playwright.config.ts, stryker.config.mjs
.github/workflows/ci.yml
dist/            # gebouwd door `npm run build`, niet in git
```

Imports tussen modules eindigen op `.ts` (`import { x } from './util.ts'`); `tsc` herschrijft die naar `.js` in `dist/`. Gebruik geen `enum`, `namespace` of parameter properties: Node draait de tests door de types weg te halen (`erasableSyntaxOnly`).

## Testen

| Laag | Waar | Wat |
|---|---|---|
| Statisch | `npm run typecheck`, `lint`, `format:check`, `audit` | TypeScript strict, ESLint (`typescript-eslint`), Prettier, `npm audit` |
| Unit/integratie | `tests/unit/` (Vitest) | `logic/`: herhalingen, tijdzones, ics, snel invoeren, foutgevallen. `main/`: alle IPC-kanalen, venster-opties en preload met een gemockte `electron`. `renderer/`: de echte `index.html` in jsdom met Testing Library (dialogen, store, lijst, zoeken). Tailwind-stijlen worden in jsdom niet toegepast: hier alleen gedrag en rollen/tekst. |
| E2E | `tests/e2e/` (Playwright + `_electron.launch`) | Start de gebouwde app met een tijdelijke `--user-data-dir`: opstarten, kernflow, opslag, beveiliging, menu, dialogen, meldingen, toegankelijkheid, toetsenbord, thema, responsive, visueel, prestaties |
| Mutatie | `npm run test:mutation` (Stryker) | Optioneel en traag; alleen `model.ts` en `occurrences.ts`. Rapport: `reports/mutation/index.html` |

Commando's:

```
npm run check            # typecheck + lint + format:check + audit + unit-tests (alles behalve E2E en mutatie)
npm test                 # Vitest, één keer
npm run test:watch       # Vitest in watch-modus
npm run test:coverage    # Vitest met V8-coverage (coverage/index.html), zonder drempels
npm run test:e2e         # bouwt eerst en draait dan Playwright
npm run test:e2e:ui      # idem, in de Playwright UI
npm run test:mutation    # Stryker
npm run format           # Prettier herschrijft de bestanden
```

Een enkele E2E-test draaien: `npx playwright test tests/e2e/storage.spec.ts -g "kapot"` (na een `npm run build`).

**Visuele regressie.** `tests/e2e/visual.spec.ts` vergelijkt screenshots met een baseline per platform (`tests/e2e/visual.spec.ts-snapshots/*-darwin.png`). De tests draaien alleen op macOS en slaan zichzelf elders over. Na een bewuste uiterlijke wijziging werkt u de baseline bij met `npm run test:e2e -- visual --update-snapshots` en bekijkt u de gewijzigde PNG's voor u ze bewaart. De klok wordt vastgezet op 26 oktober 2026, zodat datums en de tijdlijn niet verspringen.

**Een falende E2E-test debuggen.** Bij falen staat er een HTML-rapport in `playwright-report/` (`npx playwright show-report`). Draai met `npx playwright test --retries=1` of `--trace on` en open de trace met `npx playwright show-trace test-results/<map>/trace.zip`. Met `npm run test:e2e:ui` ziet u elke stap en de pagina erbij; `PWDEBUG=1 npx playwright test <bestand>` opent de inspector.

**Aandachtspunten**
- E2E-tests raken nooit uw echte data: `launchApp` geeft elke start een tijdelijke `--user-data-dir` en breekt af als `userData` ergens anders naartoe wijst.
- Native dialogen en meldingen worden in het main-proces gemockt (`electronApp.evaluate`); er verschijnt dus niets op uw scherm behalve het app-venster.
- `@axe-core/playwright` werkt niet met Electron (het opent een extra pagina); de tests draaien `axe-core` rechtstreeks via `tests/e2e/axe.ts`.
- Bekende toegankelijkheidsproblemen staan in `tests/e2e/a11y.spec.ts` (`KNOWN`); de test faalt alleen op nieuwe soorten problemen.
- `test.fail()` in `security.spec.ts` markeert een bekende beveiligingsbevinding (externe URL's worden niet geblokkeerd). Zodra dat gerepareerd is, slaagt zo'n test "onverwacht" en moet u `test.fail` weghalen.
- De opstarttijd-drempel is 8 s en aan te passen met `STARTUP_BUDGET_MS`. De geheugentest toont alleen een verschil, zonder drempel.

## Beveiliging

Het venster draait met `contextIsolation: true` en `nodeIntegration: false`, en een strikte CSP (`script-src 'self'; style-src 'self'`, dus geen inline scripts of `style`-attributen). De renderer kan Node.js niet rechtstreeks gebruiken; alles loopt via `contextBridge` in `src/preload.ts`, en `main.ts` accepteert IPC alleen van het eigen venster.

## Bekende beperkingen

- Een sleepkader (rubber band) om meerdere afspraken te selecteren is er niet; gebruik ⇧/⌘-klik of ⌘A.
- Meldingen hebben geen "Uitstellen"-knop: macOS toont knoppen in meldingen alleen voor een ondertekende app. Een klik op de melding opent wel de dag.

## Updates uitbrengen en updaten in de app

Gebruikers installeren de app één keer. Daarna controleert hij zelf op updates (kort na het opstarten en elke zes uur) en toont een knop **Update x.y.z** bovenin; ook staat er een knop in *Voorkeuren → Updates* en een menu-item *Zoek naar updates…*. Gebruikers kiezen zelf: **downloaden** en daarna **Herstart en installeer**. Er wordt nooit iets zonder hun akkoord gedownload of geïnstalleerd, en de agenda blijft behouden.

De updates staan in **GitHub Releases** van jouw repository (die moet publiek zijn, anders kan de app ze niet ophalen).

### Eenmalig instellen
1. De repository is `mitaadevelop/Notch` (publiek) en staat in `package.json` bij `repository.url`. Dat adres wordt in de app ingebouwd als updatebron.
2. De code staat al in die repository.
3. Zet bij de repository onder *Settings → Actions → General → Workflow permissions* "Read and write permissions" aan (de workflow maakt de release aan).
4. Het icoon staat in `build/` (`icon.svg` is de bron; `icon.png`, `icon.icns` en `icon.ico` zijn daarvan afgeleid).

### Een nieuwe versie uitbrengen
Het stap-voor-stapplan staat in **[RELEASING.md](RELEASING.md)**. Kort: in GitHub *Actions → Nieuwe versie → Run workflow*, of lokaal:
```
npm run release          # 0.1.0 → 0.1.1   (release:minor → 0.2.0, release:major → 1.0.0)
```
Dit verhoogt het versienummer, maakt een git-tag (`v0.1.1`) en pusht die. De workflow `.github/workflows/release.yml` bouwt daarna voor macOS (Apple Silicon én Intel), Windows en Linux en zet de bestanden in een GitHub Release. Zodra die release klaar staat, ziet elke geïnstalleerde app de update. Nieuwe gebruikers downloaden het installatiebestand (`.dmg`, `.exe` of `.AppImage`) van de releasepagina.

### Ondertekenen op macOS (belangrijk)
- **Windows en Linux** werken zonder certificaat (Windows toont bij de allereerste installatie een SmartScreen-waarschuwing).
- **macOS** kan een app alleen automatisch updaten als hij is **ondertekend en genotariseerd** (Apple Developer-account, €99 per jaar). Zonder dat downloadt de app de update wel, maar weigert macOS hem te installeren, en Gatekeeper blokkeert bovendien het eerste openen van een niet-ondertekende app. Zet voor ondertekenen deze *Repository secrets* in GitHub: `MAC_CERTIFICATE` (je "Developer ID Application"-certificaat als base64 `.p12`), `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` en `APPLE_TEAM_ID`. De workflow herkent die zelf en ondertekent en notariseert dan automatisch.

### Lokaal proberen
- `npm run pack:test` bouwt een uitgepakte, niet-ondertekende app in `release/`; `npm run test:packaged` bouwt die en draait de rooktests ertegen (de echte `electron-updater` tegen een lokale nepserver).
- `npm run dist` bouwt de installatiebestanden voor je eigen systeem (zonder te publiceren).
- In een ontwikkelversie (`npm start`) kan updaten niet; de knop is dan uitgeschakeld.
