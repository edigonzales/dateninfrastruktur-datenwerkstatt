# Quellen und Prüfstand

**Abruf/Prüfung für dieses Spezifikationspaket: 3. Oktober 2026.**

Die fachlichen Requirements sind Entwurfsentscheidungen. Die Quellen belegen vorhandene Integrationspunkte und technische Eigenschaften. Webdokumentation kann neuer als die gepinnte Codebaseline sein. Es wurden für diese Spezifikation keine produktiven Endpunkte, keine Browser-WASM-Anwendung und keine vollständige Ziel-App ausgeführt.

## Geprüfter Quellcode

Repository: https://github.com/sogis/datenportal-sodata  
Baseline: `6b45fc4e22116fba8fc00bd48175e347aa740562`  
Der Branch-Abruf nannte diesen Commit; Commitnachricht: `fix: display DATE chart axes and tooltips as ISO dates`. Die Paket-/DTO-/Controller-/Querydateien unten wurden gelesen. Weitere Dateien in der Übernahmematrix sind vor Implementierung zusätzlich zu prüfen.

### S01 — Paketbaseline
https://github.com/sogis/datenportal-sodata/blob/6b45fc4e22116fba8fc00bd48175e347aa740562/src/main/frontend/explore/package.json

Belegt den React/Vite/TypeScript/SQLRooms/DuckDB-WASM/webR-Stack und die in SPEC genannten Baselineversionen. Keine Aussage über „latest“ oder erfolgreiche Installation im späteren Agenten-Runner.

### S02 — ExploreContext v4
https://github.com/sogis/datenportal-sodata/blob/6b45fc4e22116fba8fc00bd48175e347aa740562/src/main/frontend/explore/src/app/ExploreContext.ts

Belegt versionierten Kontext mit Tabellen, Parquet-URLs, Spaltenrollen, Rezepten und bislang portalgebundenen Runtimeangaben.

### S03 — Bestehende JSON-Endpunkte
https://github.com/sogis/datenportal-sodata/blob/6b45fc4e22116fba8fc00bd48175e347aa740562/src/main/java/ch/so/agi/datenportal/explore/ExplorePageController.java

Belegt die drei Context-JSON-Routen für einzelne Datensätze, aktuelle und bestimmte Serienausgaben. Nicht geprüft wurde eine freie Volltext-Katalog-JSON-Such-API; daher keine solche API als vorhanden voraussetzen.

### S04 — Identität von Ausgaben
https://github.com/sogis/datenportal-sodata/blob/6b45fc4e22116fba8fc00bd48175e347aa740562/src/main/java/ch/so/agi/datenportal/explore/ExploreContextService.java

Belegt `datasetId = entry.identifier()` und die Ausgabe von v4-Kontext. Eine aktuelle kanonische URL ist nicht automatisch eine unveränderliche Datenversion.

### S05 — Bestehender Query-Abbruchpfad
https://github.com/sogis/datenportal-sodata/blob/6b45fc4e22116fba8fc00bd48175e347aa740562/src/main/frontend/explore/src/duckdb/executeDuckDbQuery.ts

Belegt den eigenen WASM-Abfragepfad mit `cancelSent()`, AbortSignal und Warten auf Settling. Die neue Anwendung muss tatsächliche Abbruchwirkung zusätzlich testen.

## Offizielle technische Dokumentation

### S06 — SQLRooms Persistence
https://sqlrooms.org/persistence.html

Host-eigene dauerhafte Speicherung und zusammengesetzte Zustand-Slices. Konkrete moderne API-Namen dürfen nicht ungeprüft in den 0.28.0-Baselinestand übernommen werden.

### S07 — DuckDB-WASM Query
https://duckdb.org/docs/current/clients/wasm/query

Abfrage-, Resultat- und Streaming-/Prepared-Statement-Grundlagen für den Adapter. Eigene TableHandle-/Snapshot-Schnittstellen sind keine Namen aus dieser API.

### S08 — Dexie Design und Transaktionen
https://dexie.org/docs/Tutorial/Design

IndexedDB-Transaktionen, Transaktionslebensdauer und Schema-Upgrades. OPFS gehört nicht zu einer Dexie-Transaktion.

### S09 — OPFS
https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system

Originbezogene Dateien, Zugriff über Browser-APIs, Speicherquoten und Löschung bei Websitedatenbereinigung. Keine verschlüsselte Mehrbenutzerablage und kein Backupversprechen.

### S10 — Web Locks
https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API

Koordination zwischen Tabs/Workern derselben Origin; Grundlage des Writer-Lease, nicht Autorisierung.

### S11 — DuckDB-Sicherheitsmodell
https://duckdb.org/docs/current/operations_manual/securing_duckdb/overview

SQL kann Datei-/Netzwerk-/Erweiterungsfunktionen erreichen. Ein V1-Query-Guard ersetzt keine Sandbox/Serverberechtigung.

### S12 — Typisierte webR-Objekte
https://docs.r-wasm.org/webr/latest/convert-js-to-r.html

Explizite R-Konstruktoren, Environment-Bindungen und Freigabe von R-Objektreferenzen. Dokumentation wurde als 0.6.1-dev gekennzeichnet; Baseline ist 0.6.0, daher API-Abgleich erforderlich.

### S13 — webR-Kommunikationskanäle
https://docs.r-wasm.org/webr/latest/communication.html

SharedArrayBuffer verlangt Cross-Origin-Isolation; PostMessage erlaubt laut Dokumentation kein reguläres R-Interrupt. Workerbeendigung und normaler Interrupt sind verschiedene Vorgänge.

### S14 — webR-Auslieferung
https://docs.r-wasm.org/webr/latest/serving.html

Betriebsanforderungen für webR-Assets/Kommunikation. CSP-/COOP-/COEP-Konfiguration muss gegen die tatsächliche Anwendung getestet werden.

## Weitere Implementierungsreferenz aus dem vorherigen Entwurf

TanStack Router Context: https://tanstack.com/router/latest/docs/guide/router-context

Für die Spezifikation ist nur die Auswahl verschachtelter Workspace-Routen normativ; der Agent muss die zur installierten Version passende API prüfen. Die aktuelle Seite wurde in diesem Spezifikationsdurchlauf nicht nochmals als eigener technischer Nachweis verwendet.

## Vorheriges Architekturpaket

Die im Gespräch erzeugten Dateien `ARCHITEKTUR.md`, `domain.ts` und `ports.ts` des Pakets `datenwerkstatt-architektur-v1` wurden als Ausgangsmaterial gelesen. Dieses Paket präzisiert sie. Alte Pfade/Interfaces unverändert zu kopieren, wenn sie hier korrigiert wurden, wäre nicht vertragsgemäss.
