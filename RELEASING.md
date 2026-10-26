# Een nieuwe versie uitbrengen

De repository is **https://github.com/mitaadevelop/Notch**. Elke versie hoort bij een **git-tag** (`v0.1.1`, `v0.2.0`, …):
de tag maakt de GitHub Release aan, en de app van gebruikers ziet die release als update.

```
versie kiezen ─► package.json + tag ─► workflow "Release" ─► GitHub Release ─► "Update"-knop in de app
```

## Eenmalig instellen

1. **Workflow-rechten:** GitHub → _Settings → Actions → General → Workflow permissions_ → kies
   **Read and write permissions** en zet **Allow GitHub Actions to create and approve pull requests** uit. Sla op.
   Zonder dit kan de workflow geen release aanmaken.
2. **Repository publiek houden:** de app haalt updates zonder inloggen op, dat kan alleen bij een publieke repo.
3. **(Aanbevolen) Branch main beschermen niet te streng:** de workflow "Nieuwe versie" pusht één commit
   (`Versie x.y.z`) rechtstreeks naar `main`. Een regel die directe pushes verbiedt, laat die stap mislukken.
4. **(Alleen voor automatisch updaten op macOS) Apple-ondertekening:** zonder Apple Developer-account (€99 per jaar)
   downloadt de app de update wel, maar weigert macOS hem te installeren. Zet daarvoor onder
   _Settings → Secrets and variables → Actions_ deze secrets: `MAC_CERTIFICATE` (je "Developer ID Application"-certificaat
   als base64 `.p12`), `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
   De workflow herkent ze zelf; zijn ze er niet, dan wordt de Mac-versie niet ondertekend gebouwd. Windows en Linux
   hebben dit niet nodig.

## Een versie uitbrengen (met de hand klikken in GitHub)

1. Zorg dat alles wat erin moet op `main` staat en dat de checks groen zijn (tabblad **Actions → CI**).
2. Ga naar **Actions → Nieuwe versie → Run workflow**.
3. Kies de soort versie:
   | Keuze   | Voorbeeld         | Wanneer                               |
   | ------- | ----------------- | ------------------------------------- |
   | `patch` | 0.1.0 → **0.1.1** | kleine fixes                          |
   | `minor` | 0.1.0 → **0.2.0** | nieuwe functies                       |
   | `major` | 0.1.0 → **1.0.0** | grote of niet-compatibele wijzigingen |
4. Klik **Run workflow**. De workflow doet dan zelf:
   1. het versienummer in `package.json` (en `package-lock.json`) verhogen;
   2. een commit `Versie 0.1.1` en de tag `v0.1.1` maken en pushen;
   3. de workflow **Release** starten voor die tag.
5. **Release** controleert dat tag en versie gelijk zijn, draait `typecheck` en de tests, bouwt de app voor macOS
   (Apple Silicon en Intel), Windows en Linux en zet de bestanden in een **GitHub Release** (tabblad _Releases_).
   Dat duurt ongeveer 10 tot 20 minuten.
6. Klaar. Geïnstalleerde apps vinden de update bij het opstarten of via de **Update**-knop.

## Een versie uitbrengen (vanaf je eigen computer)

```sh
git checkout main && git pull
npm run release          # patch: 0.1.0 → 0.1.1
npm run release:minor    # 0.1.0 → 0.2.0
npm run release:major    # 0.1.0 → 1.0.0
```

Dit verhoogt de versie, maakt de tag en pusht commit én tag; de tag start de workflow **Release** vanzelf.
(`npm version` weigert te draaien als je niet-opgeslagen wijzigingen hebt: commit die eerst.)

## De eerste release

De versie in `package.json` is nu `0.1.0`. Kies bij de eerste keer in **Nieuwe versie** gewoon `patch` of `minor`
(je krijgt dan `v0.1.1` of `v0.2.0`). Wil je dat de eerste release precies `v0.1.0` heet, dan doe je dit één keer lokaal:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Controleren dat het gelukt is

- **Actions** → de run "Release" heeft drie groene regels (macOS, Windows, Linux).
- **Releases** → de nieuwe release bevat `.dmg` en `.zip` (macOS), `.exe` (Windows), `.AppImage` (Linux) en de bestanden
  `latest*.yml`. Die laatste zijn wat de app gebruikt om een nieuwe versie te herkennen: haal ze nooit weg.
- Open een oudere installatie van de app → **Voorkeuren → Update** → _Controleer op updates_.

## Als er iets misgaat

| Probleem                                 | Oplossing                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Resource not accessible by integration" | Stap 1 bij _Eenmalig instellen_ (schrijfrechten) ontbreekt.                                                                                                                            |
| "Tag vX past niet bij versie Y"          | Een tag is met de hand gemaakt zonder `package.json` aan te passen. Verwijder de tag (`git push --delete origin vX`, `git tag -d vX`) en gebruik **Nieuwe versie**.                    |
| Eén van de drie platformen faalt         | Open die run, klik **Re-run failed jobs**. De andere twee blijven staan.                                                                                                               |
| Release is half klaar en je wilt opnieuw | Verwijder de release en de tag op GitHub, en begin opnieuw met een nieuwe run. Hergebruik van een versienummer waar al apps op staan wordt afgeraden: kies liever het volgende nummer. |
| Gebruikers krijgen geen update           | Controleer dat de repo publiek is, dat de release niet op _Draft_ of _Pre-release_ staat en dat `latest*.yml` erbij staat.                                                             |
