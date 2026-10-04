# Releaseprüfung V1

Stand: 4. Oktober 2026. **Technische Abnahme im dokumentierten Testprofil bestanden; keine Produktionsfreigabe.** P7 ist bestanden. P8 hat den gemischten Golden Path in Chromium, Firefox und Playwright-WebKit nachgewiesen; die abgeschlossenen Gesamtläufe werden in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) protokolliert. Der tatsächliche Safari-Pilot einschliesslich vollständigem Prozessneustart ist bestanden. Keine Veröffentlichung vorgenommen.

## Identität des Kandidaten

- Git-Basis: `0535d2fd54f14e347cb3b488c3d47767923d1b2f`; Änderungen liegen uncommittiert im autorisierten Zielrepository.
- Frischer Git-Tree-Export: `f044f1ef6142a3d1121fa93829e0c784d5232c46`, ohne kopierte Dependencies/Runtimeassets. Temporärer Index; Benutzerindex/Branch unverändert. [Exportbeleg](verification/clean-source-p8.json).
- SHA-256 über 193 Datei-Hashes: `4537f64c4b0acea0c763d52ca73b10172f5ebaa80b4bf294651e6495f12996f3`. [Einzeldateien und Verfahren](verification/code-fingerprint-p8.json). Die 193 inventarisierten Dateien stimmen weiterhin mit dem frischen Kandidaten überein. Anschliessend wurden Berichtsdokumente und die separaten nativen Safari-Tests unter `tests/safari/` ergänzt; keine Produktänderung.
- Vollständiges Linux-Image: `sha256:690098f7010ca608e1896c32bdc0c9059b52a1f8d3964e3b194fdfa646ef99b2`, `/lab/`, PostMessage, Build-ID `p8-f044f1ef`. [Buildlog](verification/p8-clean-docker-build.log), [UID-/HTTP-Beleg](verification/p8-clean-image.json).
- Node 22.23.1, npm 11.18.0, Playwright 1.63.0, Chromium 153.0.8010.12, Firefox 155.0, Playwright-WebKit 26.6. DuckDB-WASM 1.33.1-dev57.0 / Engine v1.5.4; webR 0.6.0 / R 4.6.0. macOS 27.0.1 (26A434), Apple M5, 24 GiB. Browserbenchmarks sind keine Linux-Browsernachweise.
- Quellportal sauber bei `6b45fc4e22116fba8fc00bd48175e347aa740562`; Originalbranding und übernommene Regressionen erhalten.

## Nachweise und Freigabeschritte

| Prüfung | Zustand / Nachweis |
|---|---|
| P7-Gate, UI-Flächen/Fokus/History | Bestanden; Dreiermatrix und Messwerte/Screenshots, siehe Statusbericht. |
| Frisches npm ci / Assets | Exit 0; [Installation](verification/p8-clean-install.log), [Assets](verification/p8-clean-assets.log). |
| Frisches npm run verify | **Exit 0**: 40 Unit, 43 Integration, 23 E2E, Types/Lint/Build. [Log](verification/p8-clean-verify.log). |
| Vollständige Chromium/Firefox/WebKit-Funktionsmatrix | **198 verschiedene Fälle bestanden**, 66 je Browser, keine Skips/Runner-Retries: Verify 66; Matrix 123 + separater Portalnachlauf 8 + gezielte Wiederholung 1. Erste Matrix Exit 1 wegen 120s-Testtimeout; unveränderter Einzelfall danach Exit 0 in 32,4s. [Matrix](verification/p8-browser-matrix.json), [Portale](verification/p8-browser-portal.json), [Wiederholung](verification/p8-browser-r-repeat.json). |
| Gemischter Golden Path AT-072 | Alle drei Browser bestanden: öffentliches Fixture-Parquet + lokale CSV, unveränderte SQL/R-Werte, PNG/Chart, Prozessneustart, Archiv in zweitem frischen Profil. Im frischen Gesamtlauf erneut bestanden. |
| Migration, aktiver Ersatz, späte SQL/R-Antworten | Neue P8-Tests in allen drei Browsern bestanden, Im frischen Gesamtlauf erneut bestanden. |
| Quota/Commit, kaputte/fehlende Artefakte, Multitab, ZIP-Angriffe | P6 und frische P8-Funktionsmatrix bestanden. |
| Echte Cancel-/Initfehler, CSP/Netzwerk, Root/lab/auto | P8-Gesamtmatrix Exit 1: 41/45 bestanden, vier Firefox-Init-/Testtimeouts bei parallel laufenden Suites. Unveränderte Wiederholung aller 15 Firefoxfälle ohne andere Suite **Exit 0, 15/15**, 2,6min. Zusammen mit Chromium/WebKit 30/30 sind alle **45 verschiedenen Deploymentfälle** bestanden. [Erstlauf](verification/p8-deploy-matrix.json), [Firefox-Wiederholung](verification/p8-deploy-firefox-repeat.json). |
| 20 Ressourcenzyklen, vollständige 10k/100k-Transfers | Bestanden in P7; [Messreihe](verification/p7-resources-chromium.json), [Umgebung](verification/p7-environment.json). Enginecode/Benchmark seitdem unverändert. 0 Worker/Handles nach jedem Close, exakte Summen. |
| Voller Linux-Dockerbuild / beliebige UID | Exit 0; UID 1000870000:0, read-only, cap-drop ALL, no-new-privileges; Deep Route 200 und fehlendes WASM 404. |
| Dependency-/Lizenzinventar / Audit | 400 npm-Lockeinträge, 40 kuratierte R-Pakete im Buildinventar; npm audit Exit 0, [0 bekannte Befunde](verification/npm-audit-p8.json). Distributionspflichten vor externer Auslieferung prüfen. |
| Tatsächlicher Safari-Pilot | **Bestanden.** Safari 27.0.1 (22625.1.29.11.28): Golden SQL/R, PNG, Archiv, Fenster- und vollständiger Prozessneustart, echtes Cancel und Kern-UI. [Pilotbericht](SAFARI_PILOT.md). |
| Produktive Portalbasis / CORS / Betreiberconfig | **Extern offen.** Kein erfundener Endpunkt; bestätigtes Portal konfigurieren und dessen CORS/CORP prüfen. Testportal ist ausschliesslich synthetisch. |
| Remote-CI / produktiver Ingress | Konfiguration geliefert, nicht ausgeführt/veröffentlicht. Lokale Ergebnisse nicht als entfernten CI-/Produktionsnachweis ausgeben. |

## Reproduzieren

In einem frischen Checkout/Kandidatenexport mit Node/npm gemäss Pins und verfügbarer Docker Engine:

```sh
npm ci
npx playwright install chromium firefox webkit
npm run verify
npx playwright test tests/integration tests/e2e --project=firefox --project=webkit
npm run test:resources
npm run test:deployment -- --workers=3
npm audit
npx tsc -p contracts/tsconfig.json
python3 tools/verify-package.py
```

`verify` baut lokale Assets und führt Types/Lint/Units/Build/Chromium aus. Standardmässig laufen Funktionstests seriell; Tests verwalten nur eigene Profile/OPFS-Verzeichnisse. Ports 4173/4174 und 4180–4182 freihalten. Deployment enthält echte Root-/lab-PostMessage- und lab-auto-Container in allen drei Browsern. Den vollständigen Dockerbuild separat wie in [OPERATIONS.md](OPERATIONS.md) ausführen. Unter Linux benötigt Playwright zusätzlich seine Systemabhängigkeiten (`install --with-deps` in der gelieferten CI).

Lokale Abschlussprüfung nutzt ausdrücklich gestartete Server desselben frischen Kandidaten über `DW_REUSE_DEV_SERVER=1 DW_REUSE_TEST_PORTAL=1`. Parallel zu Chromium sind Firefox/WebKit ohne die vier absichtlich globalen Portalfehlerfälle gelaufen; diese wurden danach seriell nachgeholt. Bei gleichzeitiger Funktions-/Deploymentlast traten Init-/Testtimeouts in Firefox auf; die betroffenen Fälle bestanden anschliessend unverändert ohne andere Suites. Deshalb Funktions- und Deploymentsuite wie in den Standardbefehlen/CI getrennt ausführen. Das ist Testorchestrierung, keine ausgelassene Abnahme. Standardbefehle benötigen diese Flags nicht.

## Noch erforderlich

Für Safari ist keine weitere Freigabe nötig: Pilot und vollständiger Prozessneustart sind bestanden. WebDriver scheitert weiterhin am Session-Verbindungsaufbau; der tatsächliche Pilot wurde deshalb mit nativer UI-Bedienung und realen Anwendungsdiensten ausgeführt. [Umfang und Reproduktion](SAFARI_PILOT.md).

Vor produktiver Veröffentlichung bestätigte Portalconfig und Ingressheader testen, Lizenz-/Quellbereitstellung vervollständigen und den tatsächlich ausgelieferten Build identifizieren. Remote-CI und Produktivdeployment sind nicht ausgeführt. Diese externen Schritte sind keine offene Implementierungsphase; die technischen Gates P0–P8 im dokumentierten Testprofil sind bestanden. Kein pauschales Versprechen aller aktuellen Browser und keine Produktionsfreigabe.

Zusätzlicher offener Diagnosepunkt: Safari/Monaco-Clipboard meldete beim UI-Pilot eine unbehandelte Cancellation; die geprüften Funktionspfade bestanden. Ursache und Copy/Paste-Auswirkung sind noch nicht abschliessend geklärt. [Log/Abgrenzung](SAFARI_PILOT.md#offener-diagnosebefund). Keine Aussage einer fehlerfreien Safari-Konsole.
