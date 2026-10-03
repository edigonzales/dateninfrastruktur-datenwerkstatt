# Implementierungsplan P0–P8

Phasen sind Lieferabschnitte, keine Kalender- oder Aufwandsschätzung. Nach jeder Phase relevante Unit-/Browserchecks ausführen und `docs/IMPLEMENTATION_STATUS.md` mit tatsächlichem Ergebnis aktualisieren. Eine Phase wird nicht allein durch vorhandene Dateien abgeschlossen.

## Gemeinsames Statusformat

```text
Phase / Requirement / Test
Status: offen | in Arbeit | bestanden | blockiert
Implementierte Dateien:
Verifizierte Git-Revision:
Ausgeführte Befehle mit Exitcodes:
Browser-/Runtime-Versionen:
Bekannte Einschränkungen:
Nächster konkreter Schritt:
```

Test-IDs stehen in `ACCEPTANCE_TESTS.md`. Abweichungen von SPEC über einen kleinen ADR festhalten: Problem, nachgewiesene Randbedingung, Alternativen, Entscheidung, betroffene Tests. Dies erlaubt keine ungefragte Ausweitung um Backend/KI/Login.

## P0 — Baseline und riskante Integrationsstellen verifizieren

**Abhängigkeit:** Keine. **Ziel:** Installierbarer Stand und reale, kleine Proofs statt erfundener APIs.

Quellfrontend am dokumentierten Commit prüfen. Paketdateien/Lockfile, `createExploreRoomStore`, `executeDuckDbQuery`, `ExploreContext`, `WebRRuntime`, `WebRBridge`, Typmapper, RPanel, Resultatadapter, Mirror-/WASM-/Monaco-Buildpfade und vorhandene Tests inventarisieren. Gegebenenfalls Originalbranding im vorhandenen Assetbestand lokalisieren. Keine neue Darstellung aus generierten Screenshotlogos konstruieren.

Im autorisierten Ziel ein minimales Vite-/React-Projekt mit gepinnter kompatibler Toolchain starten. Kleine Browserprüfseite ausserhalb des Produkt-UI beweist: DuckDB startet einmal, `SELECT 1` liefert Arrow, Datei registrieren/Parquet schreiben/lesen, stabiler Resultathandle, lange Query tatsächlich stoppen. Parser-/Statement-Guard-Probe für SELECT/WITH und verbotene Statements. webR startet mit lokalem Assetpfad, Dataframe binden, R-Ausdruck ausführen, Plot empfangen und PostMessage-Reset funktioniert. OPFS-Datei schreiben/lesen/löschen, IndexedDB-Transaktion und ein Writer-Lock in zwei Tabs prüfen.

**Liefern:** `docs/BASELINE.md`, `docs/MIGRATION_MATRIX.md`, Lockfile, Toolchain-Pin, kleiner echter Browser-Spiketest und Testprotokoll. Moderne SQLRooms-APIs nur nach Exportnachweis. Neue Parser-/ZIP-/Hashbibliothek begründen. Ein aus Netzgründen fehlender Installationsnachweis bleibt offen.

**Gate:** AT-001, AT-002, AT-046 und grundlegende Engine-/Storage-Smokes; keine Fake-Engine als Grundlage der weiteren Umsetzung. Import-/Cancel-Risiken sind entweder funktionierend belegt oder mit kleinster nachgewiesener Alternative dokumentiert.

## P1 — App-Shell, Domain und Workspace-Metadaten

**Abhängigkeit:** P0. **Ziel:** Ein echtes, speicherbares Projekt ohne unnötige Oberfläche.

Domainverträge in `src/domain` aufteilen und strikte Zod-/Referenzvalidierung hinzufügen. Router mit Workspace-Kontext, kompaktem Header/Sidebar und leeren Zuständen implementieren. WorkspaceService und DexieWorkspaceRepository inklusive Create/Load/Commit-Revisionsvergleich aufbauen. AppStore/WorkspaceStore sauber trennen. Autosave-Generationen und SaveStatus implementieren, keine gesamte Runtime serialisieren.

Workspace anlegen, öffnen, umbenennen und Beschreibung ändern. Monaco-Modelle/Engine-Lifecycle noch nicht in jedes Panel kopieren. Falsche ID-Routen kontrolliert behandeln. Speichern/Reopen zunächst mit leeren Datenrecords demonstrieren. Original-Logo integrieren, sofern identifiziert; fehlendes Asset explizit als Release-Abhängigkeit dokumentieren, ohne Logo zu erfinden.

**Liefern:** Domain/Schemas/Invarianten, Workspace-Routen/Shell, Repository/SaveCoordinator-Basis, Store, CRUD-/Revisions-/Routingtests.

**Gate:** AT-003–AT-007, AT-011, AT-012, AT-054, AT-057. Reload liefert dasselbe Projekt; Domain bleibt browser-/UI-frei.

## P2 — OPFS und lokale Dateneinbindungen

**Abhängigkeit:** P1. **Ziel:** CSV/Parquet wirklich laden und gesicherte Daten nach Neustart wiederfinden.

ArtifactStore mit generierten Pfaden, Länge/Hash, begrenztem Schreiben und Publish-before-reference entwickeln. CSV-Dialog mit Vorschau, Typ-/Spaltenkorrektur und gespeichertem Importvertrag. Strikter vollständiger Import, kanonisches Parquet, lokale DatasetVersion. Parquet-Import ohne stille Typreduktion. SQL-Namen, unabhängiger Anzeigename, versionierter Ersatz und Tombstones.

CapabilityProbe und ausdrücklich temporärer Modus implementieren. Quota-/Write-/Commit-Fehler über Fake-Ports injizierbar machen. Reopen der gesicherten lokalen Daten in echter DuckDB. Test-Parquet-Dateien aus den mitgelieferten CSV-Fixtures mit der gepinnten DuckDB-Testumgebung generieren; diese Daten nicht als Produktionsseed ausliefern.

**Liefern:** ImportDialog, DatasetService, OpfsArtifactStore, Typkontrakt, Fixture-Generator im Testsetup, fehlertoleranter Publikationspfad.

**Gate:** AT-008–AT-010, AT-013–AT-020, AT-024, AT-050. Fehler erzeugen weder halbe Tabellen noch beschädigte vorherige Versionen.

## P3 — SQL-Analysen, Snapshots und stabile Ergebnisse

**Abhängigkeit:** P2. **Ziel:** Drei Tabellen kombinieren, Abfrage speichern, genau einmal ausführen und Resultat stabil verwenden.

AnalysisService, ExecutionRun-Zustandsautomat, Scheduler und SqlRoomsSqlEngine implementieren. Ein Connector, per DatasetVersion gebundene Relationen, Parameter, Statement-/Source-Guard. Bei Start Code/Revision/Quellenstand einfrieren. Ergebnisregister mit stabiler Ordinalposition. Resultatpaging und numerische Sortierung auf bestehendem Resultat. Keine Benutzerquery im Grid erneut starten.

Laufzeit-/Zeilen-/Bytegrenzen und echter Cancel-/Reset-Pfad. Resultate bewusst aufbewahren; Parquet/CSV exportieren. Einfache Bar/Line/Scatter-Konfiguration mit ausgeschriebenen Grenzen. SQL-Arbeitsfläche ohne rechte permanente Infospalte. Editor/Resultat-Resize von Beginn an, statt später ein dichtes Dashboard zu entschlacken.

**Liefern:** SQL-Editoradapter, Run-/Result-Services, Query-Guard, Paging/Export/Keep, Chartkonfiguration, echte Browsertests.

**Gate:** AT-021–AT-032, AT-049, AT-055, AT-058. Golden-SQL-Resultat stimmt mit `fixtures/golden/sql-2024.json` überein. Random-/Paging-Test beweist unveränderten Ergebnisschnappschuss.

## P4 — Portaladapter und mehrere öffentliche Quellen

**Abhängigkeit:** P3. **Ziel:** Vorhandenen Portal-Context wiederverwenden, ohne einen neuen Katalogserver zu erfinden.

ExploreContext-v4-Schema aus Baseline übernehmen und auf neue Domain mappen. Die drei dokumentierten Endpunktformen unterstützen. Portalbasis/Relative URLs und `current`-Auflösung korrekt behandeln; Sicherheits-/Runtimefelder nicht übernehmen. Konfigurierte Provider/Origins prüfen.

URL-/ID-Eingabe, `/open`-Deep-Link mit Bestätigung und history replacement, optionaler CatalogIndex für Suchdialog. Indexloser Betrieb bleibt funktionsfähig. Öffentliche Datei referenzieren oder ausdrücklich lokal sichern. HTTP-Testserver mit 206/Range/CORS, Änderung von ETag und kontrollierten 404-/CORS-Fällen aufbauen. Kein Scraping der Portal-HTML-Seiten.

**Liefern:** CatalogAdapter, URL-/Deep-Link-Dialog, Konfigurationsschema, Fixture-Portalserver, getesteter alter Context-v4-Vertrag.

**Gate:** AT-033–AT-039, AT-056. Die App kann eine öffentliche Portaldatei mit einer lokalen CSV kombinieren. Es gibt keine still erfundene `/api/catalog`-Abhängigkeit.

## P5 — R-Sitzung und bidirektionaler Tabellenkreislauf

**Abhängigkeit:** P4. **Ziel:** SQL→R→SQL mit nachweislicher Datentyp- und Ergebniskorrektheit.

webR aus Panel-Lifecycle in WorkspaceSession verschieben. Lazy Initialisierung, RScopes/Epochs, Scripteditor, Konsole, Plot-/Objektansicht, Reset und echte Cancelwege. Native Typkonstruktoren/Codec mit Missing-Masken. Zunächst vorhandenen Mapper gegen Fixtures vergleichen, dann präzisierten spaltenorientierten Transfer implementieren.

Transferplan mit Source-/Scopebindung, Warnung/Hardlimits und atomischem Commit. Ergebnis bei dauerhafter R-Eingabe sichern. Rückweg eines benannten Dataframes als neuer Datensatz inklusive Capture-Lauf und Herkunft. Frischer Environmentmodus ohne falsche Isolationsgarantie. Rows/Types/NaN/Date/DECIMAL-Grenzen testen; unsupported complex/BLOB/Struct melden statt still konvertieren.

**Liefern:** WebREngine, RTypeCodec, TableTransferService, R-Komponenten, echte R-Abnahmetests, Ressourcenfreigabe.

**Gate:** AT-040–AT-048, AT-052, AT-053, AT-062. Basis-R-Skript und Rück-SQL liefern die Sollwerte. Seitenwechsel beendet R nicht, Reset invalidiert alte RObjectRefs.

## P6 — Projektarchive, Wiederherstellung und Mehrtab-Lebenszyklen

**Abhängigkeit:** P5. **Ziel:** Ein Projekt lässt sich portabel und ohne stille Datenverluste fortsetzen.

Archivmodi recipe/with-data implementieren, fehlende Artefakte explizit modellieren, vollständiges ID-Remapping und neue lokale Zielpfade. Archivgrenzen, Traversal-/Duplikat-/Symlink-/Hashschutz. Kein Auto-Run. Duplizieren nutzt denselben strukturellen Remappingkern, nicht Stringersetzung in Benutzer-Code.

Recovery/IntegrityCheck, interrupted-Läufe, session-ended-Resultate, Orphanbereinigung unter exklusivem Lock. Zwei Tabs und Revisionkonflikte integrieren. Entfernen-/Löschen-Regeln schützen historische Herkunft und aufbewahrte Inputs. Fehlerzustände bleiben sicht-/exportierbar.

**Liefern:** WorkspaceArchive, Remapping/Validation, RecoveryService, Multitab-UI, Daten-/Projektbereinigung, Archiv-/Fault-Injection-Tests.

**Gate:** AT-012–AT-017 erneut, AT-050–AT-053, AT-059–AT-065. Projekt inklusive aufbewahrtem Rundlaufergebnis in frischem Browserkontext wieder öffnen; keine fremde Runtimekonfiguration akzeptiert.

## P7 — Produkt-UI, Deployment und Betriebsdokumentation

**Abhängigkeit:** P6; Basiskomponenten entstehen bereits früher. **Ziel:** Arbeitsflächen dominieren und funktionieren im echten statischen Deployment.

Doppelte Navigation/Listen/Erklärkästen entfernen. Messbare Breiten-/Höhenregeln, Keyboardbedienung, kleine Einstellungen, Status- und Fehlermeldungen vervollständigen. Keine Screenshotdaten als echte Fakten. Originalbranding korrekt und ohne unerlaubte Fontverteilung.

Statischen Container (non-root/OpenShift UID) bauen, config/load base paths, MIME/404/History-Fallback, Cache-/Headerverhalten, selbst gehostete Runtimepakete und CORS testen. PostMessage-Profil und optionales isoliertes auto-Profil getrennt dokumentieren. Kein unkontrollierter Service Worker oder automatisch eingeführter Backendserver.

**Liefern:** Container/Serverconfig, CI, Runtimeconfig-Beispiele, README/Betriebsanleitung, Lizenz-/Dependencyinventar, UI-Screenshots und Geometriemessungen.

**Gate:** AT-054–AT-058, AT-066–AT-071. `/lab/`-Reload funktioniert; fehlende WASM-Datei liefert 404, kein HTML. Der SQL-/R-Platzvertrag ist gemessen.

## P8 — Abnahme und Pilotbereitschaft

**Abhängigkeit:** P7. **Ziel:** V1 ist belegt fertig, nicht nur demonstrierbar.

Alle Tests mit realen Engines laufen lassen. Golden Path aus AT-072 in frischem Profil und nach Reopen durchspielen. Chromium/Firefox-Versionen dokumentieren, WebKit-Smoke und tatsächlichen Safari-Pilot getrennt führen. Leistungs-/Speicherverhalten mit kleinen Fixtures sowie erzeugten 10k/100k-Datensätzen messen; Limits nicht mit erfundenen RAM-Garantien verwechseln.

Wiederholte Sessionwechsel, Cancel-/Initfehler, Netzwerk-/Speicherausfall, fehlendes Artefakt, kaputtes Archiv und Multitab-Test. Review auf doppelte Runtime/Projektwahrheit, stille Datentypverluste, dynamische Asset-/Netzexfiltration, unbehandelte Fehler und Dauer-Skeletons. Änderungen an Defaults nur nach dokumentierten Ergebnissen.

**Liefern:** `docs/RELEASE_CHECKLIST.md`, vollständige AT-Matrix, `docs/KNOWN_LIMITATIONS.md`, reproduzierbare Verify-Befehle, SHA-/Versionsangaben zu getesteten Builds. Produktive URLs/Logoassets müssen für einen tatsächlichen Release vorliegen; ihr Fehlen ist kein Grund, Kernimplementierung oder Tests zu erfinden.

**Gate:** AT-001–AT-072 alle für zugesicherte Konfigurationen bestanden; `npm run verify` Exit 0; Golden Path nachgewiesen. Offene kritische Anforderungen bedeuten „nicht vollständig abgenommen“, nicht automatisch Funktionsumfang reduzieren.
