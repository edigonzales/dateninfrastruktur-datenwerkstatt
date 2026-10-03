# Verifikation des Spezifikationspakets

Stand: 3. Oktober 2026. Dieses Dokument unterscheidet die Prüfung der Spezifikation von der späteren Prüfung einer implementierten Anwendung.

## Durchgeführte Prüfungen

| Prüfung | Umfang und Grenze |
|---|---|
| Quellenprüfung | Quellcodebaseline `6b45fc4e22116fba8fc00bd48175e347aa740562`, ausgewählte Frontend-/Controllerdateien und offizielle technische Dokumentation gelesen. Kein vollständiger Repositoryaudit. |
| TypeScript | Eigene Deklarationen unter `contracts/` mit TypeScript 5.8.3, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2022 und DOM-Libs typgeprüft. Der Zielagent muss zusätzlich die gepinnte Projekttoolchain (Baseline TypeScript 6.0.3) installieren und prüfen. |
| Requirement-Zuordnung | 80 eindeutige Requirement-IDs, 72 eindeutige AT-Szenarien, vollständige Zuordnung jedes Requirements zu mindestens einem Szenario. Das bedeutet Testplanung, nicht bereits bestandene Anwendungstests. |
| Dateien/Beispiele | Lokale Markdownlinks, JSON-Parsing, Beispiel-Dokumentreferenzen und Rezeptarchiv-Manifest geprüft. Dies ist keine vollständige Implementierung aller Zod-/Security-Prüfungen der Zielanwendung. |
| Fixture-Arithmetik | Join und Sortierung mit Python/SQLite als unabhängige Referenz berechnet; R-Klassifikationsregel zusätzlich in Python gegen die Golden-JSON geprüft. Vier Inputzeilen und Gruppenzahlen 2/1/1 stimmen überein. |
| Paketierung | Dateiinventar und ZIP-Inhalt auf Vollständigkeit geprüft. Es sind keine Fontdateien, Zugangsdaten oder Produktionsdatensätze enthalten. |

Ausgeführte reproduzierbare Befehle:

```sh
python tools/verify-package.py
tsc -p contracts/tsconfig.json
```

Das Paketprüfskript arbeitet nur mit Python-Standardbibliotheken. `tsc` muss verfügbar sein; es gehört nicht als vorgetäuschter Projektcompiler zu diesem Paket. Details des Prüflaufs werden zusätzlich in `package-check.json` abgelegt, sofern das Skript mit `--report` aufgerufen wird.

## Nicht durchgeführt / bewusst nicht behauptet

Keine React-Anwendung implementiert oder gebaut. Keine npm-Installation des Zielprojekts, keine SQLRooms-Adapterprüfung gegen installierte Baseline-Exports, kein DuckDB-WASM-Lauf, kein R-/webR-Lauf, keine Browser-/OPFS-/Web-Locks-Ausführung, keine Performance-/Speichermessung und keine Container-/OpenShift-Abnahme.

Keine produktiven Portalzugriffe oder CORS-Freigaben eingerichtet. Kein GitHub-Repository angelegt oder geändert. Keine originalen Branding-/Schriftassets ausgeliefert. Keine Parquet-Datei als fertige Testdatei behauptet; sie wird im Engine-Testsetup aus den CSV-Fixtures erzeugt.

**Der Agent erhält einen überprüften Implementierungsauftrag, nicht den Nachweis, dass dessen Anwendung bereits funktioniert.** Die tatsächliche Abnahme folgt erst anhand von `ACCEPTANCE_TESTS.md` und P0–P8.
