# Datenwerkstatt V1 — technisch geprüftes Testprofil

Dieses Repository enthält die verbindliche V1-Spezifikation und die eigenständige Anwendung. **P0–P8 sind für die dokumentierte Testkonfiguration technisch abgenommen; die produktive Veröffentlichung ist nicht freigegeben.** Implementiert sind lokale Arbeitsbereiche, bestätigte CSV-/Parquet- und Portalimporte, echte SQL-/R-Läufe, vollständiger SQL→R→SQL-Transfer, stabile Resultate/Paging, Aufbewahren, Daten-/Grafikexport und Projektarchive. Archivimport, Duplizieren, Recovery und Mehrtab-Schreibschutz erhalten Code und historische Herkunft. SQL und Dateiimport teilen einen sessioneigenen DuckDB-Connector; R startet lazy pro Workspace. P0–P8 sind geprüft. Statisches Deployment, gemessene Arbeitsflächen und Betriebsfunktionen sind geliefert; P8 weist 198 funktionale Browserfälle und 45 Deploymentfälle nach. Der echte Safari-Pilot einschliesslich vollständigem Prozessneustart ist bestanden. Vor produktiver Veröffentlichung bleiben bestätigte Portal-/Ingresskonfiguration und Distributionspflichten zu erfüllen.

Der genaue Stand, tatsächliche Befehle/Fehlläufe und offene Abnahmen stehen in [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) und [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Designsystem

[Das Designsystem](docs/DESIGN_SYSTEM.md) legt Farben und Hintergründe, Typografie, Formularlabels, Abstände, SVG-Icons und Komponenten verbindlich fest. Die Umsetzung steht im [Implementierungsstatus](docs/IMPLEMENTATION_STATUS.md), die aktuellen Screenshots und Prüfungen im [UI-Abnahmebericht](docs/verification/design-system/README.md).

## Lokaler Entwicklungsstart

Node 22.23.1 und npm 11.18.0 verwenden (`.node-version`, `engines`).

```sh
npm ci
npm run assets:prepare
npm run dev
```

Die App läuft auf `http://127.0.0.1:4173`. `public/runtime-config.json` ist ausdrücklich ein lokales Entwicklungsprofil ohne produktive Portalendpunkte. Der erste Assetabruf benötigt Netzwerkzugriff für die DuckDB-Extensions und den kuratierten R-Paketspiegel; danach werden die gepinnten, hashgeprüften lokalen Assets genutzt. Ohne erfolgreichen echten Speichertest bietet die App einen ausdrücklich zu bestätigenden Sitzungsmodus an. Browserdaten sind kein Backup.

```sh
npx playwright install chromium firefox webkit
npm run verify
npm run test:browser-matrix
npx playwright test
```

`verify` prüft TypeScript, Modulgrenzen/Lint, Unit-/übernommene Regressionstests, Build sowie reale Chromium-Integrations- und E2E-Fälle. `test:browser-matrix` führt die Integrationsfälle in allen drei Browsern aus; `npx playwright test` zusätzlich die E2E-Fälle und Ressourcenmessung. Die vollständige Zuordnung steht in [docs/ACCEPTANCE_STATUS.md](docs/ACCEPTANCE_STATUS.md). Der tatsächliche Safari-Pilot einschliesslich Prozessneustart und der fachliche Golden Path mit echtem Archiv-Rundlauf sind im dokumentierten Testprofil bestanden. Produktive Releasevoraussetzungen und der offene Safari-/Monaco-Clipboard-Diagnosebefund stehen in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

Quellbaseline und Entscheidungen: [docs/BASELINE.md](docs/BASELINE.md), [docs/MIGRATION_MATRIX.md](docs/MIGRATION_MATRIX.md), [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md). Das Quellportal wird nicht geändert.

## Einstieg

Paket in das autorisierte neue Zielrepository übernehmen. Vorhandene Dateien/Anweisungen nicht überschreiben, sondern zusammenführen. Den Text aus [PROMPT.md](PROMPT.md) an den Coding-Agenten geben.

| Datei | Zweck |
|---|---|
| [AGENTS.md](AGENTS.md) | Arbeitsregeln und Qualitätsgrenzen für den Agenten |
| [SPEC.md](SPEC.md) | Verbindlicher Produkt-, Architektur-, Daten-, UI- und Betriebsvertrag |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Reihenfolge P0–P8, konkrete Lieferobjekte und Phasengates |
| [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) | Nachprüfbare Szenarien und Requirement-Zuordnung |
| [contracts/domain.ts](contracts/domain.ts) | Serialisierbares Fachmodell |
| [contracts/ports.ts](contracts/ports.ts) | Eigene Infrastruktur-/Runtime-Schnittstellen |
| [contracts/catalog.ts](contracts/catalog.ts) | Katalogindex und aufgelöste Quellen |
| [contracts/archive.ts](contracts/archive.ts) | .dwproj-Projektarchiv |
| [contracts/runtime-config.ts](contracts/runtime-config.ts) | Betreiberkonfiguration und Pilotlimits |
| [fixtures/README.md](fixtures/README.md) | Testdaten, genaue Schemata und erwarteter SQL–R–SQL-Ablauf |
| [docs/SOURCES.md](docs/SOURCES.md) | Quellcodebaseline und offizielle technische Referenzen |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Was am Spezifikationspaket tatsächlich geprüft wurde |

## Abgrenzung

V1: lokale Arbeitsbereiche, mehrere Datenquellen, SQL, R, Austausch, Speicherung und Projektarchive. Keine KI, Anmeldung, Freigaben, ClickHouse-Ausführung, Notebook-/Canvas-Plattform oder allgemeine Pluginarchitektur.

Der Portaladapter nutzt die bereits vorhandenen `explore/context.json`-Endpunkte. Ein optionaler kleiner Suchindex ist ausdrücklich ein neuer Vertrag. Das Portal muss für den ersten funktionierenden URL-/Deep-Link-Einstieg nicht als Anwendung umgebaut werden.

## Paketprüfung

`python tools/verify-package.py` prüft Dokumentlinks, Requirement-/Test-Zuordnung, Fixture-Sollwerte und Manifestreferenzen des Pakets. `tsc -p contracts/tsconfig.json` prüft die eigenen TypeScript-Verträge. Diese Prüfungen ersetzen nicht die Browser-, Engine- und E2E-Tests.

Das Original-SVG wurde aus der geprüften so-web-components-Baseline übernommen; Herkunft und Lizenz sind dokumentiert. Die Oberfläche verwendet die kantonal lizenzierten lokalen Frutiger-Schnitte 55Roman/75Black aus sodata mit Systemfont-Fallback, JetBrains Mono 2.304 für Code und Konsole sowie lokale Bootstrap-SVGs 1.13.1. [Schriftherkunft und Nutzungsbestätigung](docs/FONT_PROVENANCE.md) sowie die Gestaltungsregeln im [Designsystem](docs/DESIGN_SYSTEM.md) sind dokumentiert. Monacos interner lizenzierter Iconfont bleibt unverändert.

## Statischer Betrieb

Container, Unterpfad `/lab/`, Betreiberkonfiguration, CSP-/Kommunikationsprofile, Diagnose und Backup sind in [docs/OPERATIONS.md](docs/OPERATIONS.md) beschrieben. `npm run test:deployment` prüft drei echte Containerprofile mit beliebiger UID. Das Produktionsimage startet ausschliesslich Caddy auf Port 8080.
