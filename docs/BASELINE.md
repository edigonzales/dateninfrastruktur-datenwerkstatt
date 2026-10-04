# Geprüfte Baseline

Stand 3. Oktober 2026. Zielrepository ursprünglich sauber bei `0535d2f` (Spezifikationspaket). Quelle: `sogis/datenportal-sodata`, Commit `6b45fc4e22116fba8fc00bd48175e347aa740562`, lokal unter `/Users/stefan/sources/datenportal-sodata`. Quellbaum nur gelesen. Kein Portalpatch, Push oder Release.

Gelesen: Frontend-Paketdateien/Lockfile, `createExploreRoomStore`, `executeDuckDbQuery`, `ExploreContext`, `WebRRuntime`, `WebRBridge`, `DuckDbToWebRTypeMapper`, `RPanel`, Resultat-/Arrowadapter, Mirror-Skript und relevante Tests. Die Dateizuordnung und weitere Arbeit stehen in [MIGRATION_MATRIX.md](MIGRATION_MATRIX.md).

Die vorhandenen Runtimeversionen wurden übernommen: SQLRooms 0.28.0, DuckDB-WASM 1.33.1-dev57.0, webR 0.6.0, Arrow 17.0.0, React 19.2.7, Monaco 0.55.1. Herauslösung und Versionsupgrade bleiben getrennt. Installierte Exports/Types wurden vor Verwendung geprüft: SQLRooms `createRoomStore`, `createBaseRoomSlice`, `createDuckDbSlice`, `createWasmDuckDbConnector`; DuckDB `getDb/getConnection`, `query`, `prepare`, `cancelSent`, `terminate`, Dateiregistrierung und Parquet; webR `Shelter`, `REnvironment`, `RDataFrame`, `captureR`, `close` und Proxyfreigabe. Die Anwendung definiert weiterhin eigene Ports.

Originalbranding: `LOGO_SVG` aus `src/main/resources/static/vendor/so-web-components/0.1.10/components/so-header.js`, unverändert als SVG extrahiert. Originale Lizenzhinweise in `licenses/`. Keine Nachzeichnung, keine Schriftdateien aus dem Portal. Die Oberfläche nutzt Systemfonts. Die Codicon-Datei im Monaco-Build ist ein gesondert lizenzierter Editor-Iconfont.

Toolchain: Node 22.23.1, npm 11.18.0, TypeScript 6.0.3, Vite 8.1.2; macOS 27.0.1 (26A434). Playwright 1.63.0: Chromium 153.0.8010.12 (1243), Firefox 155.0 (1543), WebKit 26.6 (2359). WebKit ist kein Nachweis eines Safari-Piloten.

Reale Spikes liegen ausserhalb des Produktbuilds in `tests/spike/`: CSV→Parquet→Arrow, stabiler 350-Zeilen-Snapshot, Parser/Guard, SQL-Workerende und Neustart, R-Dataframe/Summe/Plot/Workerende, OPFS, Dexie und Web Locks. 27 Integrationsprüfungen über drei Browser bestanden. Details und offene Produktabnahme: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
