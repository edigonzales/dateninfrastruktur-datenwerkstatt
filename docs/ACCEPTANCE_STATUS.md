# Abnahmestand des Arbeitsbaums

Diese Matrix bewertet Szenarien, nicht lediglich Testdateinamen. **P0–P8 sind für die dokumentierte Testkonfiguration technisch abgenommen; keine Produktionsfreigabe.** „Bestanden“ gilt für den beschriebenen lokalen Arbeitsstand und die in IMPLEMENTATION_STATUS.md protokollierten Läufe. „Teilnachweis“ ist keine erfüllte Gesamtabnahme. P7-Gate bestanden; P8 ergänzt den gemischten Golden Path mit Browserprozessneustart, echte Testmigration, Importgrenzen und verspätete SQL/R-Antworten. Abgeschlossene Gesamtläufe am frischen Kandidaten werden in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) und [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) ausgewiesen. Tatsächlicher Safari-Pilot einschliesslich vollständigem Prozessneustart bestanden; Umfang und Grenzen in [SAFARI_PILOT.md](SAFARI_PILOT.md).

| Szenario | Requirements | Stand | Nachweis / offene Arbeit |
|---|---|---|---|
| AT-001 | REQ-001, REQ-002, REQ-006, REQ-007 | Bestanden | Baseline, npm ci, Types/Exports, Build und echte Engines; siehe BASELINE.md. |
| AT-002 | REQ-008, REQ-009, REQ-010, REQ-058, REQ-059 | Bestanden | P3/P5: gemeinsamer DuckDB-Connector über Import/SQL/Resultat und R-Transfer; lazy R pro Workspace, Workerzählung und Routenwechsel im UI. |
| AT-003 | REQ-011, REQ-017, REQ-061 | Bestanden | E2E: IDs, Namen/Beschreibung, Flush/Reload ohne Engine-Start. |
| AT-004 | REQ-012, REQ-014 | Bestanden | Strikte Unit-/Referenzvalidatoren; Unicode und technische Namen. |
| AT-005 | REQ-011, REQ-034, REQ-035 | Bestanden | Unabhängige Modelle/Undo, Rename, Kopie, Archivierung; Unit/E2E. |
| AT-006 | REQ-011, REQ-013, REQ-036 | Bestanden | Unit: getrennte Revisionen, alte Versionen/Run-Snapshots/Resultate unverändert. |
| AT-007 | REQ-016 | Bestanden | Strikte Format-/Referenzprüfung; P8 separate echte Dexie-v1→v2-Migration: Fehler nach Daten-/Schemaänderung rollt beides zurück, Retry migriert gültig. Dreiermatrix. |
| AT-008 | REQ-024, REQ-025 | Bestanden | Echte DuckDB, OPFS, Reload: BOM/NULL/Leerstring/Newline/führende Nullen. |
| AT-009 | REQ-025, REQ-076 | Bestanden | 200-Zeilen-Vorschau; voller Import scheitert am späten Fehler mit Spalten-/Wertangabe. |
| AT-010 | REQ-017, REQ-024, REQ-026 | Bestanden | Echte Fixture-Parquetdatei, Prozessneustart, Originaldatei unverändert und danach entfernt. |
| AT-011 | REQ-019 | Bestanden | Unit: Generationenrace, Debounce/Maxwait; E2E Save/Reload. |
| AT-012 | REQ-020 | Bestanden | P6: echter Lauf im Writer, zweiter Tab sichtbar lesend ohne Runstart; nach Tabende Reacquire/Reload, kept Resultat lesbar. Reale IndexedDB-CAS-Konflikte überschreiben nichts. |
| AT-013 | REQ-018, REQ-022, REQ-076 | Bestanden | Realer Import mit OPFS-Quota im UI; SQL→R-Keep mit injizierter Quota, kein neuer Input/kept-Stand. Alter Stand nutzbar, expliziter Retry und Recipe-Export bestehen; Commitfehler separat geprüft. |
| AT-014 | REQ-018, REQ-021 | Bestanden | Echte OPFS-Datei ohne Metadaten nach Tabende; Cleanup unter Writer-Lock, fremde Datei erhalten. |
| AT-015 | REQ-021, REQ-037 | Bestanden | P6: Tab mitten in echter langer DuckDB-Query beendet; neuer Writer normalisiert zu interrupted ohne Wiederholung, vorher aufbewahrtes Resultat bleibt lesbar. |
| AT-016 | REQ-022, REQ-073 | Bestanden | OPFS-Probe absichtlich verweigert: Sitzungsmodus erst nach Zustimmung, eigener Memory-Store, Import/Export und permanenter Sitzungsstatus; Recipe-Archivexport im Memory-Service geprüft. |
| AT-017 | REQ-021, REQ-044 | Bestanden | P6: echte OPFS-Datei des kept Resultats entfernt und neu geöffnet; ARTIFACT_MISSING, Code lesbar, keine leere Erfolgstabelle/Neuberechnung. |
| AT-018 | REQ-014, REQ-024, REQ-027 | Bestanden | Aliasvorschlag/Kollision, Anzeigename unabhängig, echte wiederholte Imports. |
| AT-019 | REQ-013, REQ-027, REQ-036, REQ-038 | Bestanden | P8: Ersatz während tatsächlichem SQL-Lauf gesperrt, alter Snapshot v1, nächster Lauf v2; sichtbarer Schema-Diff und unveränderte Versionshistorie. Dreiermatrix. |
| AT-020 | REQ-024, REQ-026, REQ-073 | Bestanden | Header-only mit 0 Zeilen zulässig, leer/Nullbytes/defektes Parquet abgewiesen. P8: echte XLSX-ZIP-Datei invalidiert alte Vorschau; reale Datei 134217729 Bytes über unverändertem Defaultlimit abgewiesen. Dreiermatrix. |
| AT-021 | REQ-025, REQ-039, REQ-041 | Bestanden | P3 echte CSV-Imports und Golden-SQL über drei Tabellen, jahr=2024; Goldenwerte unverändert. |
| AT-022 | REQ-011, REQ-034, REQ-040 | Bestanden | SELECT 1 im leeren Workspace erzeugt echtes Resultat ohne Eingaben. |
| AT-023 | REQ-040, REQ-071 | Bestanden | Echter AST-/Produktausführungskorpus: Kommentare, Strings, CTE/UNION/Window/Subquery/UNNEST sowie verbotene Statements/Reader/Quellen. |
| AT-024 | REQ-009, REQ-012, REQ-039, REQ-059 | Bestanden | P8: verzögerte echte SQL-/R-Antworten beim Workspacewechsel verworfen; keine fremden Tabellen/Resultate in B, Handles/R-Objekte/Plotbitmaps freigegeben und native Worker geschlossen. Dreiermatrix. |
| AT-025 | REQ-035, REQ-040 | Bestanden | SQL Prepared Binding sowie P5/P6 native R-Parameter inkl. explizitem R-NULL, int64/DECIMAL als Text, Seed und Selection-Snapshot unter Editoränderung geprüft. |
| AT-026 | REQ-034, REQ-036, REQ-037 | Bestanden | Echter Goldenlauf startet mit A/2024; während Ausführung wird B/2023 gespeichert. Snapshot/Resultat bleiben A zugeordnet. |
| AT-027 | REQ-041, REQ-046 | Bestanden | 350 Randomzeilen, Seitenwechsel, numerische Sortierung, interne Parquet-Wiederherstellung und CSV-/Chart-UI ohne Queryneustart. |
| AT-028 | REQ-042 | Bestanden | Echter 1000-von-1500-Wrapper limited; SQL LIMIT 10 complete. Keine behauptete ursprüngliche Gesamtzahl. |
| AT-029 | REQ-042, REQ-055 | Bestanden | Breite repeat-Textwerte überschreiten Arrow-Bytebudget; Limitfehler vor Resultatpublikation. |
| AT-030 | REQ-037, REQ-038, REQ-043 | Bestanden | Reale lange Query, Scheduler-Doppelklicksperre, UI-Cancel, tatsächliches Workerende, neuer kleiner Lauf. |
| AT-031 | REQ-037, REQ-043, REQ-059 | Bestanden | Realer Timeout und zusätzlich künstlich nie antwortende cancelSent-API: echter Workerstop, Epoch, alte Handles/unavailable, kein später Erfolg, neuer kleiner Lauf. |
| AT-032 | REQ-044, REQ-045, REQ-048 | Bestanden | 350-Zeilen-Keep/CSV/OPFS-Reload im UI; 350-Zeilen-Nutzer-Parquet mit Originalschema reimportiert; alle 350 Randomzeilen nach interner Wiederherstellung identisch, kein exportierter Ordinal. |
| AT-033 | REQ-029, REQ-030 | Bestanden | P4-Gate: Vorhandener Context-v4-Vertrag, drei Endpunkte, relative URLs und Current-Issue auf konkrete Version aufgelöst. |
| AT-034 | REQ-029, REQ-036 | Bestanden | P4-Gate: Portalparquet und lokale CSV gemeinsam in echter DuckDB abgefragt. |
| AT-035 | REQ-029, REQ-033 | Bestanden | P4-Gate: Fehlerfälle 404/CORS/MIME sowie Quelle verändert kontrolliert abgefangen. |
| AT-036 | REQ-029, REQ-032, REQ-033, REQ-076 | Bestanden | P4-Gate: Öffentliche Bytes per Hash/ETag geprüft; lokales Sichern erzeugt neue immutable Version. |
| AT-037 | REQ-013, REQ-028, REQ-033, REQ-057 | Bestanden | P4-Gate: Eingefrorene konkrete Quelle und Herkunft, geänderter öffentlicher Stand auch bei gecachter Relation erkannt. |
| AT-038 | REQ-032, REQ-060, REQ-071 | Bestanden | P4-Gate: Bestätigter Deep Link ohne Autorun, kontrollierte Vorschau, history replacement. |
| AT-039 | REQ-031 | Bestanden | P4-Gate: Optionaler validierter Index und indexloser URL-/ID-Betrieb. |
| AT-040 | REQ-049, REQ-058, REQ-059 | Bestanden | P5-Dreiermatrix: lazy webR, genau ein Worker bei Routenwechseln; Objektzustand bleibt, Reset/Schliessen beendet Runtime. |
| AT-041 | REQ-050, REQ-051, REQ-057 | Bestanden | P5: unverändertes Golden-R-Skript in echter webR, Sollwerte aus golden/r-vergleich.json und Rück-SQL in drei Browsern. |
| AT-042 | REQ-045, REQ-052, REQ-055 | Bestanden | P5: vollständige 350 Zeilen trotz 100er Gridseite, Reihenfolge/Integer erhalten, Keep vor InputBinding, kein Skript-Autostart. |
| AT-043 | REQ-054 | Bestanden | P5: echter SQL→R→SQL-Rundlauf int32-Minimum, 2^53+1, DECIMAL und 001; ungültiger DECIMAL-Rückcast abgewiesen. |
| AT-044 | REQ-054 | Bestanden | P5-Dreiermatrix nach NA-Korrektur: separate R-Missing-Maske erhält NULL/NA, NaN, ±Inf und Leer-/NULL-String; ADR-004. |
| AT-045 | REQ-054, REQ-057 | Bestanden | P5: Date, UTC, hochpräzise Timestamps als exakter annotierter Text, Faktorlevels; BLOB/Struct/list-Spalten ausdrücklich abgewiesen. |
| AT-046 | REQ-049, REQ-056 | Bestanden | P7 ergänzt echten auto/SAB-Interrupt ohne Workerreset und erfolgreiche Folgeausführung in allen drei Browsern; PostMessage beendet den Worker. ADR-008, Deploymentmatrix 36/36. |
| AT-047 | REQ-050, REQ-057 | Bestanden | P5: sieben zusätzliche Fresh-Läufe, Pruning auf fünf inaktive Scopes, alte Pläne/Refs nach Reset ungültig; kein Prozessisolationsversprechen. |
| AT-048 | REQ-051, REQ-053, REQ-057 | Bestanden | P5: expliziter aktueller Dataframe-Capture als eigener Lauf/Resultat/Version, tatsächliche Objektänderung und Golden-Rück-SQL geprüft. |
| AT-049 | REQ-047, REQ-048 | Bestanden | Bar-Reihenfolge, reale Zeichenoperationen/Pixel, Line-Sortierung und NULL-Lücke, Scatter/PNG, 5000-Punkt-/100-Kategoriegrenze und Keep-vor-Chart geprüft. |
| AT-050 | REQ-018, REQ-044, REQ-045 | Bestanden | SQL-Chart/gespeicherter R-Input: erfolgreiche Sicherung, injizierter Quota-/Commitfehler ohne Veröffentlichung dauerhafter Referenzen. Vorheriger temporärer Stand bleibt, Dateien werden Orphans. |
| AT-051 | REQ-068, REQ-069 | Bestanden | P6: echter Golden-SQL→R→SQL-/PNG-/Chartstand per UI exportiert und in frischem persistentem Browserprofil importiert; alle IDs remapped, Code/Aliase gleich, vor Zugriff kein Engineworker. Öffentliche Quellen nur per Opt-in eingebettet; Offline-Abfrage danach funktioniert. |
| AT-052 | REQ-038, REQ-053, REQ-055, REQ-059 | Bestanden | P5 stale Epoch/Scope/Revision blockieren Transfer. P6 Workspacewechsel nach erstem echten OPFS-Capturewrite bricht laufenden Transfer ab; keine halbe/verspätete Veröffentlichung, neues Projekt unverändert, Rest bereinigbar. |
| AT-053 | REQ-015, REQ-021, REQ-045 | Bestanden | P6: Golden-Herkunftsgraph mit kept Resultat und abgeleitetem Dataset nach Archivimport; ursprüngliche Analyse archiviert/Quelle entfernt, Orphancleanup bewahrt benötigte Versionen/Artefakte/Snapshots. Fremde OPFS-Dateien in Faultfällen erhalten. |
| AT-054 | REQ-065, REQ-066 | Bestanden | P7: SQL und echte R-Grafik bei 1440×900/1280×800 in drei Browsern gemessen/gesichtet; 56px Header, 52px Sidebar, Höhe ≥75%, Breite ≥90%, kein Überlauf. JSON/PNG in verification/p7-*. |
| AT-055 | REQ-062, REQ-063, REQ-067 | Bestanden | P7: Fokusfang/Escape/Rückgabe in drei Browsern, Save/Selection-Run und tastaturbedienbare Splitter; native Dialoge mit expliziter WebKit-Fokusführung. |
| AT-056 | REQ-005, REQ-030, REQ-032, REQ-033, REQ-071, REQ-072 | Bestanden | P4/P6 URL-/Config-/Archivschutz ergänzt durch P7 XSS-Zellmarker und statischen lokalen/öffentlichen SQL→R→SQL-/Archivpfad unter CSP mit Netzwerkprüfung in 9 Profilen. |
| AT-057 | REQ-003, REQ-004, REQ-061, REQ-064, REQ-065 | Bestanden | Originalbranding/Systemfonts, leeres Produktionsprofil, implementierte Editor-/Sidebar-/Speichereinstellungen und expliziter datenarmer Diagnoseexport; P7 Dreiermatrix. |
| AT-058 | REQ-019, REQ-034, REQ-058, REQ-059, REQ-060 | Bestanden | P7: SQL/R-Layout und R-Sichtbarkeit persistent; Back/Forward erhält Cursor/Undo und Zugehörigkeit; Layout verändert keine Domainrevision. Native Browsermatrix 3/3 plus 9 UI-Fälle. |
| AT-059 | REQ-016, REQ-068, REQ-069 | Bestanden | P6: originale sample.dwproj (Deflate) inspiziert/bestätigt, neue IDs, drei fehlende Datenstände und kein Engine-/Code-Autostart; Metadatenvalidator bestätigt Referenzen. |
| AT-060 | REQ-070, REQ-071 | Bestanden | ZIP32-Unitkorpus: Traversal/Absolut/Backslash/NUL, doppelte Namen, Symlinks, Verschlüsselung, unmanifestierte Daten und alle Budgets. Echter Browser-Decompressor zählt Expansion trotz gefälschter Headerlänge. |
| AT-061 | REQ-018, REQ-021, REQ-070 | Bestanden | P6: SHA-manipulierter Archiveintrag wird vor Publikation abgelehnt; echtes OPFS-Byte verändert, nach Reopen ARTIFACT_CORRUPT, kein scheinbar erfolgreiches Resultat, Code bleibt lesbar. |
| AT-062 | REQ-052, REQ-054, REQ-055 | Bestanden | P5: Warnschwelle 10001 erfordert Freigabe, 100001 blockiert, Unsupported-/Darstellungswarnungen und versionsgebundene Pläne; keine Teilübernahme. |
| AT-063 | REQ-015, REQ-023, REQ-069 | Bestanden | P6 UI: Golden-Projekt dupliziert, Original bestätigt gelöscht, Kopie mit neuen IDs/Bytes weiter lesbar. Unit: anderes Projekt exakt unverändert, stale Revision blockiert, Löschreste nach Verzeichnisfehler sicher bereinigbar. |
| AT-064 | REQ-018, REQ-069, REQ-070 | Bestanden | P6: echte OPFS-Extraktion mit anschliessendem injiziertem Metadata-Createfehler; kein halbes Projekt, Original gültig. Cleanup unter Lock entfernt nur neue Reste, fremde Datei bleibt. Gleichzeitige Importcommits gesperrt. |
| AT-065 | REQ-020, REQ-022 | Bestanden | P6 UI mit navigator.locks deaktiviert: bestehendes Projekt nur lesend, Mutationen deaktiviert, Archivexport möglich. Expliziter neuer Sitzungsmodus mit richtigem Status und eigener Projektliste. |
| AT-066 | REQ-074 | Bestanden | P7: vollständiger frischer Linux-Build; UID 1000870000:0, read-only, cap-drop ALL/no-new-privileges. Echte Caddycontainer in Dreiermatrix. |
| AT-067 | REQ-060, REQ-073, REQ-074 | Bestanden | P7: Root/lab tiefe Reloads, MIME/Range/Cache/echte 404, ungültige Betreiberconfig fail-closed; 36 Deploymentfälle bestanden. |
| AT-068 | REQ-005, REQ-033, REQ-071, REQ-072, REQ-075 | Bestanden | P7: 9 Profile (3 Browser × Root/lab PostMessage/lab auto) mit öffentlichem/lokalem Import, SQL→R→SQL, PNG, Chart und Archiv unter CSP; nur lokale Assets/konfigurierte Fixture-Origin, keine CSP-Verletzung/Service Worker. |
| AT-069 | REQ-049, REQ-073, REQ-074, REQ-075, REQ-076 | Bestanden | P7: echte Asset-404/MIME-/Worker-CSP-/beschädigte WASM-Fehler, Initialisierungsdeadline, tatsächliche Freigabe und Retry. ADR-006/007, Deploymentmatrix. |
| AT-070 | REQ-007, REQ-077, REQ-078, REQ-079, REQ-080 | Bestanden | P8 frischer Git-Tree: npm ci/verify/voller Linux-Dockerbuild Exit 0. 40 Unit, 198 Funktions- und 45 Deploymentfälle nachgewiesen; Ersttimeouts und unveränderte gezielte Wiederholungen dokumentiert. Tatsächlicher Safari-Pilot inklusive Prozessneustart bestanden (SAFARI_PILOT.md); Remote-CI nicht ausgeführt. |
| AT-071 | REQ-038, REQ-055, REQ-056, REQ-059, REQ-073, REQ-076, REQ-078, REQ-080 | Bestanden | P7: 20 echte persistente Workspace-/SQL-/R-Resetzyklen; jeder Close 0 Worker/0 Handles, Reset 0 R-Objekte; vollständige 10k/100k-Transfers und exakte Summen. Gemessene Umgebung/Zeiten dokumentiert, kein RAM-Peakversprechen. |
| AT-072 | REQ-001, REQ-003, REQ-017, REQ-029, REQ-041, REQ-045, REQ-048, REQ-052, REQ-053, REQ-068, REQ-069, REQ-077, REQ-078, REQ-079, REQ-080 | Bestanden | P8: gemischter öffentlicher/lokaler Golden-UI-Pfad mit unveränderten SQL/R-Sollwerten, PNG/Chart, echtem Browserprozessneustart und Archivimport im zweiten frischen Profil in Chromium/Firefox/WebKit bestanden. Nativer Safari-Pilot zusätzlich: gleiche Goldenwerte, PNG, Archivimport, Cancel und vollständiger Safari-Prozessneustart bestanden. Safari-Umfang separat in SAFARI_PILOT.md; keine zweite frische Safari-Profilprüfung behauptet. |
