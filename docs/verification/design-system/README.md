# UI-Abnahme — Designsystem

Stand 10. Oktober 2026. Ausgangspunkt `c1d4bc0`; neuer, uncommitteter Kandidat
im [Dateifingerprint](code-fingerprint.json). Die 231 historischen Prüfbelege
und der historische Implementierungsstatus bleiben unverändert
([Umfangskontrolle](scope-check.json)). Keine Änderung an Domain, Anwendung,
Engines, Speicher, Contracts oder fachlichen Goldenwerten.

## Gelieferter Umfang

[Gestaltungsvertrag](../../DESIGN_SYSTEM.md), lokale Komponenten und Tokens,
weisse Flächen, Labels mit 14 px/700 und 8 px Feldabstand, 8 px Aktionsabstand
auch beim Umbruch. Migration von Einstieg, Übersicht, Projektdetail, Import,
Archiv/Transfer, Einstellungen, Navigation und SQL/R. Native Dialoge, Tastaturmenüs,
Hover-/Fokustooltips, Zustände und zugängliche Formularverknüpfung.

Frutiger stammt ausdrücklich aus **datenportal-sodata**: 55Roman/75Black,
CSS-Gewichte 400/700 wie im Portal. [Bytevergleich](font-source-check.json),
[Herkunft und bestätigter Nutzungskontext](../../FONT_PROVENANCE.md).
JetBrains Mono 2.304 und Bootstrap Icons 1.13.1 ebenfalls lokal mit Originalhinweisen.
[Originalabgleich der 22 SVGs](icon-source-check.json): Hashes und Pfade stimmen mit
dem unveränderten Bootstrap-Paket überein.
Die Entwicklungsreferenz `/tests/design-system/` startet keine Engines und wird
nicht in `dist` ausgeliefert. Keine neuen npm-Abhängigkeiten.

## Ausgeführte Prüfungen

Umgebung und genaue Browserstände: [environment.json](environment.json).
Keine automatischen Retries. Fachliche Tests verwenden echte DuckDB-/webR-Engines;
die Komponentenreferenz bleibt ausdrücklich enginefrei.

| Befehl / Nachweis                                                                                                            | Ergebnis                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run verify`, [Log](verify-complete.log)                                                                                 | Exit 0: Types, Lint, Build, 40 Unit-, 43 Integrations- und 26 Chromium-E2E-Tests               |
| UI-E2E in Firefox/WebKit, [Log](cross-browser-ui-complete.log)                                                               | Exit 0: 14 bestanden                                                                           |
| Übrige E2E in Firefox/WebKit, [Log](e2e-regression-matrix.log)                                                               | Exit 0: 38 bestanden                                                                           |
| Statisches Deployment, [Log](deployment-final.log)                                                                           | Exit 0: 27 bestanden                                                                           |
| `python3 tools/verify-package.py --report docs/verification/design-system/package-check.json`, [Bericht](package-check.json) | Exit 0: lokale Dokumentlinks, 80 Requirements, 72 Abnahmeszenarien, Beispiele und Fontinventar |
| Prettier auf geänderten UI-/Testdateien, [Log](format-final.log)                                                             | Exit 0                                                                                         |
| `git diff --check`                                                                                                           | Exit 0                                                                                         |
| [Abschliessender Dateiabgleich](fingerprint-check.json)                                                                      | Exit 0: alle 196 erfassten Code-/Test-/Fixture-Dateien unverändert                             |

Damit ist die vollständige E2E-Suite mit **26 Fällen je Browser** bestanden:
Chromium, Firefox und WebKit, insgesamt **78 E2E-Fälle**. Ausführung der
Firefox-/WebKit-Suite in zwei disjunkten Gruppen:

```sh
npx playwright test --project=firefox --project=webkit tests/e2e/design-system.spec.ts tests/e2e/p7-ui.spec.ts
npx playwright test --project=firefox --project=webkit tests/e2e/archive.spec.ts tests/e2e/imports.spec.ts tests/e2e/multitab.spec.ts tests/e2e/p8-golden.spec.ts tests/e2e/p8-imports.spec.ts tests/e2e/portal.spec.ts tests/e2e/r.spec.ts tests/e2e/sql.spec.ts tests/e2e/workspaces.spec.ts
DW_REUSE_TEST_PORTAL=1 npx playwright test -c playwright.deploy.config.ts tests/deployment/static.spec.ts
```

Nach dem ersten erfolgreichen Verify-Lauf wurden zwei kleine Produktkorrekturen
vorgenommen: SQL-Revisionsnummern sind im Leerlauf keine Live-Ansagen mehr;
Firefox darf das kurze R-Lauf-Label nicht auf mehrere Zeilen zusammenschieben.
Die gezielte Browserprüfung und der erneute komplette Verify-Lauf oben umfassen
beide Korrekturen; ebenso die abschliessende Browsermatrix. Der vorherige
erfolgreiche Verify-Lauf bleibt in [verify-sodata.log](verify-sodata.log) erhalten.

Die 27 statischen Prüfungen umfassen drei Browser und drei Profile: `/` PostMessage,
`/lab/` PostMessage und `/lab/` auto. Echte Container mit beliebiger UID,
Deep-Link/Reload, CSP/MIME/Cache, reale SQL/R-Ausführung, alle Navigations-SVGs,
Frutiger 400/700 und Mono, WOFF2-MIME, Lizenzinventar und absichtlich blockierte
Fontladung mit funktionsfähigem SQL-Fallback. Keine externen Font-/Iconabrufe.
Dieser Lauf liegt vor den beiden rein lokalen UI-Korrekturen; Assets, Buildpfade
und Deploymentkonfiguration wurden danach nicht geändert.

## Darstellung und Geometrie

- Zielansichten 1440×900 und 1280×800: Übersicht, Projekt, SQL, R, Import und
  Einstellungen in Chromium, Firefox und WebKit. Screenshots liegen in diesem Ordner.
- Komponenten zusätzlich bei 720×450 als Layoutäquivalent zu 200 % Zoom;
  tatsächlicher nativer Safari-Zoom separat unten. Lange Labels, Fehler und
  umbrochene Aktionen mit 8 px Abstand. DOMRect-Rundungstoleranz 0.005 CSS px.
- Kopf 56 px, Sidebar 52/212 px. Analysebedienung SQL 81 px, R 88 px.
  Bei 900 px Höhe SQL-Arbeitsfläche 735 px (81.7 %), R 728 px (80.9 %),
  jeweils volle verfügbare Breite. SQL-Editor rund 328 px, Ergebnis rund 400 px.
  Bei 800 px Höhe SQL 635 px, R 628 px; keine horizontale Seitenüberbreite.
- JSON-Messungen: [Chromium](p7-geometry-chromium.json),
  [Firefox](p7-geometry-firefox.json), [WebKit](p7-geometry-webkit.json).
  Komponentenabstände: [Chromium](components-chromium.json),
  [Firefox](components-firefox.json), [WebKit](components-webkit.json).
- [Textkontraste](contrast.json): alle acht geprüften Tokenpaare mindestens 4.5:1.
- [Nativer Safari-Smoke](safari-smoke.md): lokale sodata-Fonts, Fokusfang/-rückgabe,
  Menü-Tastatur, echter 200-%-Zoom und Plot-Vollbild. Safari 27.0.1, macOS 27.0.1.
  Kein vollständiger neuer nativer Safari-Engine-/Persistenzlauf behauptet.

## Zwischenbefunde und Grenzen

Die folgenden Versuche sind keine erfolgreichen Abschlussbelege:

- `verify.log`: Exit 1; 25/26 E2E bestanden, R-Transferdialog während gleichzeitiger
  UI-Edits verschwunden. Isolierter Wiederholungstest `r-recheck.log` bestand,
  anschliessend vollständiger Verify-Lauf ohne Produktedits bestanden.
- `verify-final.log`: nach Nutzerwunsch zum Fontwechsel kontrolliert abgebrochen,
  Exit 130. `frutiger-ui.log` (7 bestanden) verwendete noch den LTCom-Zwischenstand.
- `deployment.log`: zwei neue Tests luden eine neu angelegte Analyse vor dem
  Speichern neu; Versuch abgebrochen, Exit 130. Test speichert nun ausdrücklich
  und wartet auf „Lokal gespeichert“. Vollständiger Wiederholungslauf 27/27.
- `e2e-browser-matrix.log`: wegen zu striktem Gleichheitsvergleich bei Firefox-
  DOMRect-Rundungen abgebrochen, Exit 130. CSS-Abstand unverändert 8 px.
- `cross-browser-ui.log`: Exit 1, 11/14 bestanden. Firefox liefert Anführungszeichen
  im berechneten Schriftnamen; WebKit setzt fehlgeschlagene CSS-FontFaces bei
  Grössenwechsel auf „unloaded“ zurück. Tests prüfen nun normalisierten Namen
  und explizite abgelehnte Fontladung. Der reale Firefox-Umbruch des R-Lauf-Labels
  wurde durch `flex-shrink: 0` behoben.
- `cross-browser-ui-final.log`: Exit 1, 13/14 bestanden; blosses Scrollen behebt
  den FontFace-Status nach WebKit-Grössenwechsel nicht. Separat mit und ohne
  Grössenwechsel reproduziert; abschliessender expliziter Ladetest besteht.
- Breiter zusätzlicher Prettier-Check über `src`: Exit 1 wegen bereits bestehender
  Formatierung in `src/infrastructure/catalog/ExploreContext.ts`; Datei unverändert.
- Paketprüfung während temporärer Deploymentverzeichnis-Bereinigung: Exit 1;
  abschliessender serieller Lauf nach den Browserprozessen bestanden.

Der bereits vor diesem UI-Auftrag dokumentierte Monaco-/Safari-Clipboard-Befund
erscheint weiterhin in einzelnen WebKit-Logs. Er wurde nicht unterdrückt und wird
nicht als behoben ausgegeben; siehe [Safari-Pilot](../../SAFARI_PILOT.md#offener-diagnosebefund).
Die dargestellten Tastatur-, Fokus- und Vollbildprüfungen bestehen unabhängig davon.
