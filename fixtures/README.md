# Testdaten und Golden Path

**Alle Gemeinden und Zahlen in diesem Verzeichnis sind synthetische Testdaten.** Sie sind keine amtlichen Werte und keine Kopie von Produktionsdaten. Die Gemeindenamen dienen ausschliesslich als Testbezeichnungen.

## 1. Dateiinventar

| Dateien | Verwendung |
|---|---|
| `gemeinden.csv`, `bevoelkerung.csv`, `fahrzeuge.csv` | Vier fiktive Gemeinden, zwei Jahre, reproduzierbarer Join |
| `schemas.json` | Verbindliche Spaltentypen und Rollen für diese drei Quellen |
| `csv-edge-cases.csv` | UTF-8-BOM, CRLF, eingebetteter Zeilenumbruch, Umlaute, Semikolon im Text, NULL-/Leerstring-Abgrenzung |
| `01-fahrzeuge-pro-1000.sql` | SQL-Analyse mit gebundenem Parameter `jahr=2024` |
| `02-vergleich.R` | R-Klassifikation ohne zusätzlich benötigte Pakete |
| `02b-plot.R` | Separater Basis-R-Plot für den Plot-Capture-Test |
| `03-klassifikation.sql` | SQL-Auswertung der aus R zurückübernommenen Tabelle |
| `04-typgrenzen.sql`, `05-unsupported.sql` | Eingaben für Typgrenzen und ausdrücklich nicht unterstützte R-Transfers |
| `golden/*.json` | Fachliche Sollresultate, nicht in den Produktionscode einzubauen |
| `workspace.empty.json` | Leeres serialisiertes Arbeitsbereichsdokument |
| `workspace.recipe.json` | Arbeitsbereichsdefinition mit Quellen ohne lokale Bytes und zwei gespeicherten Analysen |
| `sample.manifest.json`, `sample.dwproj` | Gültiges Rezeptarchiv mit `manifest.json`, ohne Datendateien |
| `explore-context*.example.json` | Synthetische Antworten gemäss vorhandenem ExploreContext V4 |
| `catalog-index.example.json` | Beispiel des neuen, optionalen Suchindexvertrags |
| `runtime-config.dev.example.json` | Entwicklungsprofil für einen lokalen Testportalserver |
| `acceptance-index.json` | Maschinenlesbare AT-Szenarien mit Requirement-Zuordnung |

## 2. Import der drei Hauptquellen

UTF-8, Header vorhanden, Trennzeichen `;`, Quote/Escape `"`, Dezimalpunkt `.`. `gemeinde_id` ist **VARCHAR** und trägt die Rolle `identifier`. Die Werte `001`–`004` dürfen nicht zu 1–4 werden. Alle Typen gemäss `schemas.json` explizit übernehmen. Die Tabellenaliase sind `gemeinden`, `bevoelkerung` und `fahrzeuge`; SQL-Namespace ist `data`.

Im neuen Arbeitsbereich mindestens eine Quelle über den Portaladapter hinzufügen. Der Testserver stellt dazu eine **wirkliche Parquet-Datei** aus denselben synthetischen CSV-Werten bereit. Die anderen Quellen können über den Dateidialog importiert werden. Der Golden Path darf nicht ausschliesslich aus fest im Store hinterlegten Tabellen bestehen.

Die Parquet-Dateien sind **nicht in diesem Spezifikationspaket enthalten**. Der Coding-Agent erzeugt sie in seinem Testsetup mit einer zum gepinnten DuckDB-Stand passenden Engine aus den CSV-Dateien, mit expliziten Typen. Keine CSV-Datei lediglich in `.parquet` umbenennen. Erzeugungsverfahren und Toolversion protokollieren; dieselben Werte anschliessend über den tatsächlichen DuckDB-WASM-Importer prüfen. Ein nativer Generator darf nur Fixtureproduktion übernehmen, nicht den WASM-Integrationstest ersetzen.

`csv-edge-cases.csv` wird separat geprüft. Die Hauptquellen enthalten keine problematischen Freitextfelder. Für quoted/unquoted Empty eine CSV-Bibliothek/API verwenden, welche diese Information tatsächlich erhält; Python `csv.DictReader` allein reicht nicht, um beide Formen nach dem Lesen wieder zu unterscheiden.

## 3. Fachlicher SQL–R–SQL-Ablauf

1. Drei Tabellen registrieren. Die Analyse `01-fahrzeuge-pro-1000.sql` speichern und `jahr` als numerischen Parameter 2024 binden; nicht per Stringersetzung in SQL einbauen.
2. Ausführen. Resultat muss vier Zeilen liefern, sortiert wie `golden/sql-2024.json`.
3. Resultat in R als `daten` übernehmen. Bei dauerhafter Inputbindung zuerst aufbewahren. `02-vergleich.R` als gespeichertes Skript ausführen.
4. Das erzeugte Dataframe-Objekt `vergleich` auswählen und unter SQL-Alias `vergleich` in denselben Arbeitsbereich zurückübernehmen. Capture-Lauf und Herkunft speichern.
5. `03-klassifikation.sql` ausführen. Resultat muss den drei Gruppen aus `golden/rueck-sql.json` entsprechen.
6. Für den Plotnachweis `02b-plot.R` ausdrücklich ausführen. Plot aufbewahren und PNG herunterladen; nicht bloss ein vorgerendertes Bild anzeigen.
7. Arbeitsbereich und erforderliche Artefakte sichern, Browserkontext neu starten, gespeicherte Quellen/Analysen/aufbewahrte Resultate ohne Code-Autostart öffnen. Das gilt zusätzlich für Export/Import in einen anderen leeren Browserkontext.

### Erwartete erste Auswertung

| ID | Gemeinde | Bevölkerung 2024 | Fahrzeuge 2024 | Fahrzeuge pro 1'000 |
|---|---|---:|---:|---:|
| 002 | Bergtal | 2200 | 1650 | 750.0 |
| 001 | Auenried | 1100 | 660 | 600.0 |
| 003 | Lindenwil | 4400 | 1760 | 400.0 |
| 004 | Seedorf | 0 | 10 | NULL |

`NULLIF` schützt den Nullnenner. Die R-Regel lautet: fehlender Kennwert → `nicht berechenbar`; Kennwert ≥600 → `hoch`; sonst `niedrig`. Erwartete Gruppenzahlen: **hoch: 2; nicht berechenbar: 1; niedrig: 1**.

`COUNT(*)` wird in der Golden-JSON als Dezimalstring gespeichert (`"2"` statt einem JSON-BigInt). Der Testadapter normalisiert den tatsächlichen DuckDB-BIGINT entsprechend, ohne im echten SQL-/R-Datenpfad pauschal Ganzzahlen in Strings umzuwandeln. DOUBLE-Kennzahlen dieser Fixtures sind exakt als die angegebenen ganzen Werte darstellbar; für weitere numerische Tests ausdrücklich begründete Toleranzen verwenden.

## 4. Lokaler Portaltestserver

Die Konfiguration verwendet `http://127.0.0.1:4174/` als **Testwert**. Es handelt sich nicht um einen produktiven Endpunkt. Der Agent stellt im Testprojekt einen entsprechenden kontrollierten Server bereit, getrennt vom produktiven App-Container.

Mindestens bereitstellen:

- `/datasets/demo.bevoelkerung/explore/context.json`: Antwort entsprechend `explore-context.v4.example.json`.
- `/series/demo.bevoelkerung/issues/current/explore/context.json`: Antwort entsprechend `explore-context.issue-current.example.json`.
- `/series/demo.bevoelkerung/issues/demo.issue-2024/explore/context.json`: dieselbe konkret aufgelöste Ausgabe.
- `/fixtures/bevoelkerung.parquet`: aus der CSV generiertes Parquet, GET/HEAD/Range und erwartete Content-Header korrekt unterstützen.
- `/catalog-index.json`: Inhalt aus `catalog-index.example.json`.

Prüfen: Wechsel von `current` zu einer neuen simulierten Ausgabe ändert einen bereits gespeicherten Datenstand nicht automatisch. Der Alias `/issues/current/` ist keine unveränderliche Version. Die Quelle aus der Issue-Antwort hat als konkrete ID `demo.issue-2024`.

Die V4-JSON enthält absichtlich Runtime-Pfade zu `untrusted.example.invalid`. Der Standalone-Adapter darf diese **nicht** als Script-/Paketquelle verwenden. Er verwendet ausschliesslich seine Betreiberkonfiguration. Weitere Tests schalten CORS, HTTP-Status, Range-Unterstützung oder ETag gezielt um. Nicht erreichbare URLs als Fehler zeigen, nicht durch ein positives Mockresultat ersetzen.

## 5. Rezeptarchiv und fehlende Daten

`sample.dwproj` enthält nur `manifest.json`; `files` ist leer. Die drei Quelldefinitionen nutzen `backing.kind=missing` und `reason=recipe-import`. Das ist ein gültiger, aber noch nicht ausführbarer Arbeitsbereich. Der Import zeigt den Zustand und verlangt die erneute Bereitstellung der fehlenden Daten, statt aus Dateinamen automatisch auf lokale Benutzerdateien zuzugreifen.

Beim Import alle internen IDs remappen; externe Portal-IDs und die SQL-Namen bleiben unverändert. Die mitgelieferten IDs sind deterministisch für Tests, keine IDs, die neue Benutzerprojekte immer wieder erhalten sollen. SQL-/R-Code nicht durch globale UUID-Stringersetzung verändern.

## 6. Was hier bereits geprüft ist

Das Paketprüfskript prüft Referenzintegrität, Sollwerte und den Referenz-SQL-Join zusätzlich mit Python/SQLite. Es führt **kein R** und **kein DuckDB-WASM** aus. Diese unabhängige Sollwertprüfung schützt vor fehlerhaften Fixtures, ersetzt aber keinen Engine-, Browser-, Speicher-, Roundtrip- oder UI-Test der Anwendung. Der tatsächliche Verifikationsumfang steht in [VERIFICATION.md](../docs/VERIFICATION.md).
