# Herauslösung aus dem Quellfrontend

Alle Quellpfade relativ zu `src/main/frontend/explore/` des in [BASELINE.md](BASELINE.md) genannten Commits. „Offen“ bedeutet keine vorgetäuschte Produktimplementierung.

| Quellteil | Entscheidung und Ziel | Nachweis / verbleibende Arbeit |
|---|---|---|
| package.json / package-lock.json | Baselineversionen beibehalten, Paketbestand reduziert; ein npm-Projekt | Lockfile, Installation und Build; zusätzliche Dependencies in DEPENDENCIES.md |
| src/duckdb/createExploreRoomStore.ts | Selektive BaseRoom-/DuckDB-Slices in src/infrastructure/sqlrooms/room.ts | Session-eigener gemeinsamer Connector für Import, SQL, Resultate und R-Tabellentransfer; P3/P5 geprüft |
| src/duckdb/executeDuckDbQuery.ts | Unveränderte Kopie und Tests in tests/baseline/duckdb | cancelSent + reale Termination/Reset-Epoch im P3-Scheduler; ADR-001/003 |
| src/app/ExploreContext.ts | Unveränderte Referenz unter tests/baseline/app | Strikter v4-Adapter unter infrastructure/catalog mit realen HTTP-/DuckDB-Tests; P4 geprüft |
| src/app/ExploreContextLoader.ts | Portal-Loader nicht als globale Runtimekonfiguration übernehmen | Eigene Provider-/Originprüfung, Current-Auflösung und Deep-Link; P4 geprüft |
| src/webr/WebRRuntime.ts | Installierte APIs geprüft, lokaler Browser-Spike | Session-eigene produktive Runtime/Scopes, native Typmasken und echter PostMessage-Stop; P5 geprüft |
| src/webr/WebRBridge.ts | Kein unveränderter Transfer des bisherigen Row-Objektwegs | Spaltenorientierter Codec mit Missing-Masken, exakten Textrepräsentationen und atomarer Übernahme; P5 geprüft |
| src/webr/DuckDbToWebRTypeMapper.ts | Unverändert samt Tests in tests/baseline/webr | Unveränderte Baselineregression; neuer Codec zusätzlich mit NaN/Inf, NULL, Integer-/Decimal-/Zeitgrenzen geprüft |
| src/webr/RPanel.tsx | Panel-Lifecycle nicht übernehmen | Eigene R-Workbench; Sitzungsobjekte bleiben über Routen, Reset/Close beendet Runtime; P5 geprüft |
| src/results/arrowResult.ts / sqlResultSnapshot.ts | Arrow-/Resultatverwendung gelesen | Eigenes P3-Ergebnisregister, private Relation/Ordinale, numerisches Paging und Parquet-Wiederherstellung geprüft |
| ResultPanel / ResultExport / Diagramme | Produkt-UI nach eigenem Flächenvertrag bauen | P3: vollständiger CSV-/Parquetexport, Bar/Line/Scatter, gespeicherte Konfiguration/PNG und Grenzen geprüft |
| scripts/mirrorWebRPackages.mjs, Test, Lock | Übernommen, Zielpfade auf einzelnes npm-Projekt angepasst | 40 Pakete mit SHA-256-Pins lokal gespiegelt; echte Installation/Versionsprüfung in drei Browsern bestanden |
| WASM-/Monaco-Pfade | Versionierte lokale Assets, Monaco-Vite-Worker | Build geprüft; Unterpfad-/Container-Abnahme P7 offen |
| so-header.js LOGO_SVG | Original-SVG bytegleich extrahiert | src/assets/kanton-solothurn.svg; Lizenz in licenses/ |

Bereits übernommene Regressionen werden weder deaktiviert noch durch geänderte Sollwerte umgangen. Nicht übernommene Paneltests hängen an der bisherigen Portaloberfläche; neue Produktpfade erhalten eigene Tests, sobald die betreffende Phase umgesetzt wird.

P4: `ExploreContext.ts` zusätzlich bytegleich nach `src/infrastructure/catalog/ExploreContext.ts` übernommen. DTO bleibt getrennt von Domain und RuntimeConfig. Neue Projektion und Netzwerkpolicy in `portal.ts`; keine Abhängigkeit von hypothetischem Katalog-REST-Endpunkt. Quelldatei und Lizenz unverändert.
