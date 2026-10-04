# Betrieb der Datenwerkstatt

Die Anwendung ist statisch und speichert Daten ausschliesslich im jeweiligen Browserprofil. HTTPS ist ausserhalb von localhost für OPFS/Web Locks erforderlich. Es gibt keinen Anwendungsserver, Login oder serverseitiges Backup. Browserdaten nicht löschen, um einen Fehler zu beheben: zuerst ein Projektarchiv mit Daten exportieren. Recipe-Archive enthalten keine lokalen Datenbytes. Aufbewahrte Resultate und Archivexport sind bewusste Aktionen.

## Bauen und starten

Node 22.23.1 / npm 11.18.0; `npm ci`, `npm run assets:prepare`, `npm run dev`. Produktionsbuild: `npm run build`. `postinstall` prüft und wendet die begrenzte SQLRooms-Anpassung aus ADR-007 an. npm-Lock, Extension- und R-Paketchecksummen sind verbindlich. Der erste Assetaufbau benötigt öffentliche npm-/DuckDB-/r-wasm-Downloads; der Browser verwendet danach ausschliesslich lokale Runtimeassets.

```sh
docker build -f deploy/Dockerfile --build-arg BUILD_ID=pilot-local -t datenwerkstatt:pilot .
docker run --rm --user 1000870000:0 --read-only --cap-drop=ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=32m -p 127.0.0.1:8080:8080 datenwerkstatt:pilot
```

Caddy auf Port 8080 ist der einzige Runtimeprozess. `setcap -r` im Build entfernt die für diesen hohen Port unnötige Low-Port-Capability, damit beliebige UIDs mit `cap-drop=ALL` starten. Es werden nur `/tmp`-Unterverzeichnisse benötigt. TLS übernimmt der vorgeschaltete Ingress; dessen Header dürfen die hier geprüfte CSP nicht unbemerkt ersetzen. Keine Secrets in Build-Args oder Runtime-JSON.

Unterpfad und Kommunikationsprofil sind Buildentscheidungen:

```sh
docker build -f deploy/Dockerfile --build-arg APP_BASE_PATH=/lab/ --build-arg WEBR_CHANNEL=post-message --build-arg BUILD_ID=pilot-lab -t datenwerkstatt:lab .
```

`APP_BASE_PATH` muss in Vite, Runtime-JSON und Serverconfig übereinstimmen. Deep Links/Reload benutzen dieselbe Origin und denselben Pfad. `/workspaces`, `/sql`, `/r`, `/data`, `/settings` und `/open` sind begrenzte History-Routen. Unbekannte Assetpfade liefern echte 404, niemals HTML. JS/WASM erhalten richtige MIME-Typen; `.gz`/`.tgz` sind Dateiformate und werden ohne Content-Encoding ausgeliefert. Versionierte vendor-/gehashte assets-Dateien sind immutable, HTML/Runtime-JSON müssen revalidieren. Bei Assetänderungen Version/Pfad ändern.

## Betreiberkonfiguration

`public/runtime-config.json` ist ein ausdrücklich bezeichnetes Entwicklungsprofil ohne erfundene Produktivportale. `deploy/runtime-config.lab.example.json` ist ebenfalls ein lokales Beispiel. Für ein reales Portal dessen bestätigte HTTPS-Basis, ID und öffentliche Daten-Origins in eine separate Datei eintragen. `RUNTIME_CONFIG_FILE` wählt diese beim Generator; z.B. nach `APP_BASE_PATH=/lab/ npm run build`: `APP_BASE_PATH=/lab/ WEBR_CHANNEL=post-message BUILD_ID=pilot RUNTIME_CONFIG_FILE=deploy/operator.json node scripts/deployment.mjs`. Danach mit `deploy/runtime.Dockerfile` ein Image aus `dist` und der erzeugten Caddyfile bauen (siehe Testdeployment als reproduzierbares Beispiel). Keine fremden Runtimepfade aus Katalog/Archiv übernehmen.

Origins sind exakte Origins ohne Pfad, Query oder Credentials. Der Generator setzt CSP-connect-src passend zur Allowlist. Browser-CORS ist zusätzlich erforderlich; externe Quellen im isolierten Profil brauchen geeignete CORS/CORP-Antworten. Die App verwendet vollständige, budgetbegrenzte Downloads und übernimmt konkrete Portal-Issue-/Hash-/ETag-Herkunft; HTML-Scraping und ein erfundenes `/api/catalog` sind nicht erforderlich. Die drei Context-v4-Endpunktformen und der optionale Katalog stehen in SPEC und contracts/catalog.ts.

## CSP und Profile

Baseline `post-message`: kein SharedArrayBuffer-Versprechen. Abbruch einer blockierenden R-Berechnung beendet den Worker; ungesicherte R-Objekte/Scopes gehen verloren. `auto` setzt COOP same-origin und COEP require-corp; wenn der Browser isoliert ist, wird SAB benutzt und ein echter Interrupt versucht, mit Workerreset als Rückfall. Beide Pfade brauchen getestete Daten-/Assetheader. Kein Service Worker, kein Offline-Neustart-Versprechen.

Die Dokument-CSP erlaubt lokale Skripte, `wasm-unsafe-eval`, blob-Worker, lokale/blob/data Bilder, lokale Fonts und notwendige dynamische Styles. Nur die Antwort auf den exakt versionierten `webr-worker.js` erlaubt zusätzlich `unsafe-eval`, weil webR 0.6.0 dies zum Start benötigt; der echte Fehl-/Erfolgstest und die Begrenzung stehen in ADR-006. Keine Wildcard-Origin. Benutzer-SQL/R ist absichtliche lokale Codeausführung und keine Mehrbenutzersandbox. Fremde Metadaten bleiben Text.

## Fehler, Diagnose und Sicherung

Asset-404/MIMEfehler werden konkret angezeigt. Init-Timeout beendet die Runtime, Retry startet eine neue. Ein defektes WASM darf keinen Dauerladezustand hinterlassen. Bei Quota-/Schreibfehlern bleibt der bisherige Stand erhalten; Speicherplatz prüfen, benötigte Projekte mit Daten exportieren und nur ausgewählte Projekte oder sicher erkannte verwaiste Dateien entfernen. Die Anwendung löscht nie global alle Browserdaten.

Projektübersicht bietet expliziten Diagnoseexport: IDs, Zähler, Runtimeversionen und begrenzte lokale Phasenmessungen. Code ist standardmässig ausgeschlossen und nur nach Checkbox enthalten. Keine automatischen Tabellen-/Parameter-/Dateiwerte, keine Telemetrie. Die Speicherschätzung ist ein Browserwert und keine RAM-Garantie. Limits aus Runtime-JSON sind Sicherheits-/Pilotbudgets, keine zugesicherte Kapazität.

`npm run verify` prüft Types/Lint/Units/Build/Chromium. `npx playwright test` prüft drei Browser; `npm run test:deployment` prüft Root, /lab/ und auto in echten nichtprivilegierten Containern. Beide Browserbefehle benötigen exklusiv ihre Ports 4173/4174 bzw. 4174/4180–4182. Die CI führt diese seriell aus. Playwright-WebKit ist kein tatsächlicher Safari-Pilot. Abnahmematrix und letzte Exitcodes sind in IMPLEMENTATION_STATUS.md und ACCEPTANCE_STATUS.md verlinkt.

## Lizenzlieferung

`npm run build` erzeugt `dist/licenses/`: npm-Inventar mit verfügbaren Lizenztexten, Bundleinventar, alle 40 kuratierten R-Paket-DESCRIPTION-/Lizenzdateien samt Hashes sowie Hinweise auf native Runtimeassets. Originalbranding und MIT-Quellportalhinweise bleiben erhalten; keine kantonalen Fonts werden ausgeliefert. Bei externer Distribution GPL-/sonstige Quellbereitstellung anhand des Inventars prüfen und die exakten entsprechenden Quellen beilegen/verfügbar machen. Ein automatischer Inventarlauf ersetzt keine externe Releasefreigabe.

Im isolierten auto-Profil startet R technisch mit `interactive:true`, damit webR 0.6.0 nach einem SAB-Interrupt weitere Anfragen verarbeitet (ADR-008, direkter Vergleich mit anschliessendem 6*7-Nachweis). Das bietet keine interaktive REPL-/Eingabeoberfläche; ein auf Eingabe wartendes Skript kann weiterhin per Timeout/Reset beendet werden. PostMessage bleibt `interactive:false`. Skripte, die `interactive()` auswerten, können die beiden Profile unterscheiden.

Die 20 Ressourcenzyklen einschliesslich 10k/100k gehören zu `npm run test:resources` (`tests/benchmarks/`). Die CI führt sie zusätzlich zu Verify aus. Das trennt die länger laufende Messreihe von den funktionalen Integrationstests, ohne sie zu deaktivieren. `npx playwright test` enthält weiterhin auch diese Messreihe.


## Verifizierter Kandidat und Wiederholung

Der P8-Kandidat mit Git-Tree, Dateihashes, Linux-Image-ID und tatsächlichen Exitcodes ist in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) dokumentiert. Dokumentierte historische Testfehler bleiben im Statusbericht erhalten. Die normale V1-Konfiguration bleibt bis zur vollständigen Abnahme als Entwicklungsstand bezeichnet; produktive Portalendpunkte müssen ausdrücklich bereitgestellt werden.

Für lokale Parallelprüfung können ausdrücklich gestartete, identische Kandidatenserver über `DW_REUSE_DEV_SERVER=1` und `DW_REUSE_TEST_PORTAL=1` wiederverwendet werden. Dann gehören Start/Ende dieser beiden Server dem Aufrufer. Unterschiedliche Kandidaten dürfen nicht dieselbe Serverorigin teilen. Die absichtlich globalen Portalfehlerfälle (`tests/integration/portal.spec.ts`, `tests/integration/archive-portal.spec.ts`, `tests/e2e/portal.spec.ts`) seriell ausführen; andere Netzwerkpfade besitzen eigene unveränderliche UUID-Fixtures. Standardprüfbefehle brauchen diese Flags nicht.
