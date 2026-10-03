# Datenwerkstatt V1 — Implementierungsspezifikation für einen LLM-Coding-Agenten

**Spezifikationsversion:** 1.0.0 · **Datum:** 3. Oktober 2026  
**Auftrag:** Eigenständige Browseranwendung aus dem SQL-/R-Lab von `sogis/datenportal-sodata` entwickeln.  
**Status:** Verbindlicher vorgeschlagener Implementierungsvertrag für V1, keine Behauptung über bereits implementierte Funktionen.

## 0. Lesereihenfolge, Verbindlichkeit und Arbeitsauftrag

Zuerst `AGENTS.md`, dann diese Spezifikation, `contracts/`, `ACCEPTANCE_TESTS.md` und den gerade anstehenden Abschnitt in `IMPLEMENTATION_PLAN.md` lesen. `docs/SOURCES.md` dokumentiert die geprüfte Ausgangsbasis. `PROMPT.md` ist der direkt verwendbare Startauftrag.

**MUSS** bezeichnet ein Abnahmekriterium. **SOLL** bezeichnet die bevorzugte Lösung; eine Abweichung benötigt einen dokumentierten Grund und Tests. **DARF** bezeichnet zulässigen Spielraum. Die mit `REQ-…` gekennzeichneten Anforderungen sind normativ; die zugehörigen Absätze gehören zur jeweiligen Anforderung. Typen unter `contracts/` sind eigene Schnittstellen, keine tatsächlich existierenden SQLRooms- oder webR-Funktionen.

Rangfolge bei Unterschieden: ausdrückliche neue Nutzerentscheidung → diese Spezifikation → Domain-/Schnittstellenverträge → Abnahmetests → Implementierungsplan → ältere Architektur und Mockups. Ein entdeckter innerer Widerspruch wird nicht still durch Ignorieren eines Tests gelöst: minimalen, mit dem fachlichen Ziel verträglichen Entscheid dokumentieren, Vertrag und Test konsistent korrigieren. Grössere Umfangsänderungen nicht eigenmächtig vornehmen.

**REQ-001 — Fertig ist ein nachgewiesener Arbeitsablauf, nicht eine überzeugende Oberfläche.** Zielablauf: Arbeitsbereich erstellen → lokale Datei und öffentliche Portalquelle hinzufügen → SQL speichern und ausführen → das vollständige bezeichnete Ergebnis nach R übernehmen → R-Tabelle zurück nach SQL übernehmen → notwendige Daten sichern → Browser neu starten → Projekt mit nachvollziehbarer Herkunft wieder öffnen. Während der Implementierung entstehen keine Fake-Erfolge, fest eingebauten Ergebniszahlen oder Produktionspfade mit Mock-Engines.

**REQ-002 — Quellenbaseline.** Gelesener Ausgangsstand ist `sogis/datenportal-sodata` Commit `6b45fc4e22116fba8fc00bd48175e347aa740562`. Vor einer Übernahme Arbeitsbaum und tatsächlich verfügbaren Stand prüfen. Ein neuerer Stand darf nach dokumentierter Diff-Prüfung verwendet werden; nicht ungeprüft Quellcode unterschiedlicher Stände mischen. Das Quellrepository bleibt ohne gesonderten Änderungsauftrag unverändert. [S01–S05]

## 1. Produktziel und Umfang

Die Datenwerkstatt ist ein lokal arbeitendes Analysewerkzeug. Ein Arbeitsbereich ist ein Projekt mit benannten Dateneinbindungen, SQL-/R-Analysen und ausgewählten Ergebnissen. Er ist weder eine Datenbankverbindung noch ein Benutzerkonto. Das Datenportal bleibt Katalog und Datenlieferant, nicht die Grenze des Analyseprojekts.

**REQ-003 — V1-Umfang.** Vollständig implementieren:

| Funktion | Verbindlicher Umfang |
|---|---|
| Arbeitsbereiche | Erstellen, öffnen, umbenennen, beschreiben, duplizieren, löschen, exportieren/importieren |
| Daten | Mehrere Tabellen; lokale UTF-8-CSV und Parquet; öffentliche Parquet-Quellen aus dem Portal |
| SQL | Gespeicherte benannte Abfragen, Parameter, Ausführung, Abbruch, stabile Resultate |
| R | Gespeicherte Skripte, explizite Eingaben, Konsole als Ausgabe, Grafiken, Objektliste, Reset |
| Austausch | SQL-Ergebnis → R-Dataframe; ausgewählter R-Dataframe → Datensatz im Workspace |
| Ergebnisse | Tabelle, PNG-Plot, einfache Diagrammkonfiguration, Aufbewahren, CSV/Parquet/PNG-Export |
| Speicherung | Projektmetadaten in IndexedDB; Dateien/Artefakte in OPFS; Recovery und Export |
| Oberfläche | Arbeitsbereiche, Daten, SQL, R, kleine persönliche Einstellungen |
| Betrieb | Statischer Build, Container, Runtime-Konfiguration, automatische Tests, Release-Nachweise |

**REQ-004 — Nicht in V1.** Kein Login, Benutzerprofil, Besitzer-/Rollenmodell, Freigaben, Kollaboration, KI, ClickHouse-Ausführung, privater S3-Browser, serverseitige R-Ausführung, Notebook/Canvas, Dashboard-Builder, Echtzeit-Sync, Plugin-Marktplatz oder allgemeiner Workflow-Designer. Keine funktionslosen Menüpunkte dafür. Excel-Import, Geometrie-Editor und vollständige Offline-PWA sind ebenfalls nicht zugesichert. Ein nicht unterstütztes Format bekommt eine verständliche Meldung, keine heimliche Konvertierung.

Eine kopierte Quellfunktion darf für den V1-Vertrag begrenzt werden, wenn die Begrenzung hier festgelegt ist; dies in der Migrationsmatrix festhalten. Es ist insbesondere keine V1-Anforderung, die früheren umfangreichen Mockups vollständig nachzubauen.

**REQ-005 — Umgang mit Daten.** Die App selbst lädt lokale Dateien nicht auf einen Server hoch. Modell-/Telemetriedienste werden nicht eingebaut. Das ist keine Sandbox-Zusage für beliebigen vom Nutzer bewusst ausgeführten R-Code und keine Freigabe zum Verarbeiten besonders schützenswerter Daten. V1 verarbeitet öffentliche Daten und eigene Dateien, deren lokale Verarbeitung zulässig ist. Projektdateien können Code enthalten und werden nie automatisch ausgeführt.

## 2. Technologiestack und Abhängigkeiten

**REQ-006 — Architekturstack.** React + TypeScript + Vite als SPA; TanStack Router; selektive SQLRooms-Bausteine; DuckDB-WASM; webR; Zod; Dexie Core; OPFS. Zustand/SQLRooms bildet einen zusammengesetzten Workspace-Store. Kein Next.js, SSR, Redux, zweiter allgemeiner Client-Store oder zusätzlicher Anwendungsserver nur für statische Dateien.

Geprüfte Ausgangsabhängigkeiten aus dem Portal-Frontend (keine Aussage, dies seien jeweils die neuesten Veröffentlichungen):

| Bibliothek | Baseline |
|---|---|
| React / React DOM | 19.2.7 |
| SQLRooms-Pakete | 0.28.0 |
| DuckDB-WASM | 1.33.1-dev57.0 |
| webR | 0.6.0 |
| Apache Arrow JS | 17.0.0 |
| Monaco | 0.55.1 |
| react-resizable-panels | 3.0.6 |
| Zod | 4.4.3 |
| TypeScript | 6.0.3 |
| Vite | 8.1.2 |
| Vitest | 4.1.9 |

**REQ-007 — Versionsdisziplin.** Bestehenden Lockfile-Stand soweit möglich übernehmen. Neue Abhängigkeiten wie Router, Dexie, Playwright, Archivbibliothek und direkte Zustand-Abhängigkeit passend zu Peer-Dependencies auswählen, exakt fixieren und im Lockfile dokumentieren. Kein `latest`, kein ungeprüftes Major-Upgrade während der Herauslösung. Node-Version an den tatsächlich installierten Vite-/Toolchain-Engines ausrichten und in `.node-version` sowie CI fixieren; mindestens die dokumentierten Baseline-Anforderungen prüfen. Nicht allein wegen vorhandener globaler Tools unbemerkt auf eine andere Compiler-Version wechseln.

SQLRooms-Dokumentation unter `/latest` beziehungsweise der aktuellen Website kann APIs beschreiben, die die Baseline nicht besitzt. Jede verwendete Funktion muss in installierten Types/Exports oder einem passenden Versionstag nachgewiesen sein. Eigene Ports aus diesem Paket dürfen nicht als vermeintliche SQLRooms-Imports verwendet werden. [S01, S06]

Eine kleine Bibliothek für ZIP-Verarbeitung oder inkrementelles Hashing ist zulässig. Auswahl, Lizenz, Bundlewirkung und benötigte Browser-APIs dokumentieren. Kein eigenes ZIP-/SQL-/CSV-Parsing aus improvisierten Regex-Ausdrücken. JSON-Schemas und kleine Namensnormalisierung sind projektspezifisch.

## 3. Modulstruktur und Verantwortlichkeiten

**REQ-008 — Ein npm-Projekt mit Modulgrenzen.** Zielstruktur:

```text
src/
  app/                    # bootstrap, Router, Provider, konkrete Zusammensetzung
  domain/                 # Typen, Zod-Schemas, fachliche Invarianten
  application/            # Services, Ports, WorkspaceSession, Persistenzkoordination
  infrastructure/
    sqlrooms/             # genau eine SQLRooms/DuckDB-Anbindung
    webr/                 # R-Lifecycle, Codec, Objektadapter
    storage/              # Dexie, OPFS, Archiv, Recovery
    portal/               # ExploreContextV4Adapter, kleiner Katalogindex
    browser/              # Locks, CapabilityProbe, Ressourcenverwaltung
  state/                  # AppStore, WorkspaceStore, Slices
  features/
    workspaces/ data/ sql/ r/ results/ settings/
  ui/                     # Buttons, Dialoge, Splitter, Status, App-Chrome
  styles/ assets/
public/
tests/{unit,integration,e2e,fixtures}/
scripts/
docs/{adr,verification}/
```

**REQ-009 — Importregeln.** Domain importiert keine Browser-API, React-, SQLRooms-, DuckDB-, webR- oder Dexie-Typen. Anwendungsschicht kennt Domain und eigene Ports. Infrastruktur implementiert Ports. `app` verbindet alles. React-Oberflächen rufen Anwendungsfälle auf, nicht direkt `indexedDB`, OPFS oder Worker. Ein schmaler SQLRooms-Tabellenadapter darf technische Grid-APIs kapseln, aber keinen unabhängigen Ausführungspfad für Benutzer-SQL eröffnen. Importgrenzen mit ESLint oder äquivalenter Prüfung absichern.

**REQ-010 — Zuständigkeiten.**

| Einheit | Verantwortung |
|---|---|
| WorkspaceService | Projekt-CRUD, Öffnen, Klonen, Archivoperationen |
| DatasetService | Import, Namen, Schemata, Versionen, Quelle entfernen/ersetzen |
| AnalysisService | Gespeicherter Code, Snapshot, Laufstart/-ende/-abbruch |
| ResultService | Ergebnisregister, Paging, Aufbewahren, Diagramm/Export |
| TableTransferService | Transferplan, Typkonversion, Freigabe und SQL–R-Rundlauf |
| PersistenceCoordinator | Autosave, Generationen, Dateiveröffentlichung, Commit, Recovery |
| WorkspaceSession | Ein Store, Engines, Scheduler, Handles, laufende Operationen |

Keine abstrakten Fabriken/Interfaces für jede kleine Hilfsfunktion. Die Ports sind technische Grenzen, kein Auftrag zum Bau eines allgemeinen Frameworks.

## 4. Fachliches Datenmodell

**REQ-011 — Kanonisches Dokument.** `WorkspaceDocument` unter `contracts/domain.ts` ist die gespeicherte Projektdefinition. `formatVersion`, Speicherrevision, Analyserevision und Datensatzversion haben verschiedene Aufgaben. Alle fachlichen Entitäten liegen als ID-indizierte Records vor. Bytes, Zeilenarrays, Worker, Verbindungen, R-Proxies und Arrow-Objekte gehören nicht hinein.

| Entität | Regeln |
|---|---|
| Workspace | Name, Beschreibung, Zeitstempel; kein Eigentümer in V1 |
| Dataset | Benannte Dateneinbindung; gehört genau einem Workspace; stabiler SQL-Name |
| DatasetVersion | Unveränderlicher Metadatensatz mit Schema, Herkunft und Datenverweis |
| Analysis | Veränderlicher benannter Code; SQL oder R; gehört genau einem Workspace |
| ExecutionRun | Konkreter Lauf mit eingefrorenem Snapshot und veränderlichem Laufstatus |
| Result | Konkretes Tabellen- oder PNG-Ergebnis eines Laufes |
| Visualization | Kleine Darstellungsdefinition auf einem konkreten TableResult |
| Artifact | Unveränderliche Bytes in OPFS mit Hash, Grösse und generiertem Pfad |

**REQ-012 — Referenzintegrität.** Jede ID ist eine von der App erzeugte UUID. Record-Schlüssel müssen den Objekt-IDs entsprechen. Jede Referenz bleibt innerhalb desselben Workspace. `Dataset.currentVersionId` verweist auf eine Version genau dieses Datensatzes. Eingabereferenzen auf Ergebnisse müssen Tabellen sein. `Result.runId` und `Run.resultIds` müssen übereinstimmen. Diagramme dürfen nur auf TableResults zeigen. URLs sind keine Objekt-IDs. Keine fachlichen IDs aus Tabellenzellen als interne Primärschlüssel verwenden.

Die Zuordnung ist:

```text
Workspace 1 -> 0..* Dataset -> 1..* DatasetVersion
Workspace 1 -> 0..* Analysis -> 0..* ExecutionRun
Workspace 1 -> 0..* ExecutionRun -> 0..* Result
Workspace 1 -> 0..* Visualization -> 1 TableResult
ExecutionSnapshot -> konkrete DatasetVersion / TableResult
DatasetVersion.origin(result) -> 1 TableResult
```

Ein Capture-Lauf eines bestehenden R-Objekts darf ohne neue gespeicherte Analyse existieren. Eine Analyse darf null Eingaben haben (`SELECT 1`). Resultate können wieder Eingaben sein. Ein PlotResult und eine gespeicherte Diagrammkonfiguration sind unterschiedliche Dinge.

**REQ-013 — Unveränderlichkeit und Verfügbarkeit.** DatasetVersion, Ausführungs-Snapshot, Ergebnisinhalt und Artefaktbytes werden nach Veröffentlichung nicht überschrieben. Eine neue CSV oder Portalausgabe erzeugt eine neue Version. Verfügbarkeit/Retention eines Resultates darf sich ändern, nicht sein historischer Inhalt. Eine Remote-URL ist zunächst nur eine Referenz: der unveränderliche Metadatensatz garantiert keinen unveränderlichen Serverinhalt. Nur tatsächlich lokal gesicherte und gehashte Bytes gelten als durch die App gesicherter Stand. `publisher-version`, ETag und Zeitstempel sind schwächere Herkunftsnachweise.

**REQ-014 — Namen.** Workspace-/Analysenamen: getrimmt, 1–120 Zeichen, keine Steuerzeichen; Beschreibung maximal 4000 Zeichen. Anzeigenamen dürfen Umlaute enthalten. Technische Dataset-Namen: `^[a-z_][a-z0-9_]{0,62}$`, im gesamten Workspace inklusive Tombstones eindeutig; Namen mit `__dw_` sind reserviert. Vorschlag aus Dateinamen/Portaltitel, Umlaute normalisieren, sonst `_`, Kollisionen `_2`, `_3` usw. Erstimport lässt Korrektur zu; spätere Änderung des technischen Namens ist in V1 nicht vorgesehen. Anzeigenamenänderung verändert SQL nicht.

Spaltennamen werden nicht ungefragt übersetzt. Doppelte/leere Spaltennamen müssen vor Import deterministisch aufgelöst und in der Vorschau angezeigt werden; Originalname in Metadaten erhalten. SQL-Identifier werden zusätzlich korrekt gequotet, Werte werden parametrisiert. R-Variablennamen für Bindungen: `^[A-Za-z][A-Za-z0-9_]{0,63}$`; reservierte R-Wörter, `params` und `lab_`-Präfix ablehnen. Vom Nutzer selbst geschriebener R-Code unterliegt seiner normalen R-Syntax.

**REQ-015 — Entfernen und Historie.** Analyse entfernen setzt `archivedAt`, Dateneinbindung entfernen `removedAt`; historische Snapshots und Quellenherkunft bleiben erhalten. Entfernte Einbindungen sind für neue unqualifizierte Abfragen nicht verfügbar. Abhängige gespeicherte Analysen anzeigen; unbekannte SQL-Abhängigkeiten nicht als vollständig erkannt ausgeben. Verwendete Eingaben nicht automatisch umbiegen. Ein explizit benutztes Resultat oder eine dafür nötige Datenversion kann nicht durch pauschale Cachebereinigung verschwinden. V1 bietet kein automatisches Umschreiben von Benutzer-Code.

Ein nicht referenziertes Ergebnis darf verworfen werden: Handle/Datei freigeben und Verfügbarkeit `discarded` setzen. Aufbewahrte Resultate, aktive Analyse-Inputs und Diagrammquellen sind geschützt. Historienbereinigung berücksichtigt den Referenzgraphen; in der Oberfläche zunächst maximal 100 Läufe laden/anzeigen, nicht deshalb blind alle älteren Daten löschen. Quellversionen werden in V1 nicht automatisch zeitgesteuert gelöscht. Ganze Workspaces können nach Bestätigung vollständig gelöscht werden.

**REQ-016 — Validierung und Evolution.** Strikte Zod-Schemas an jeder Dateisystem-, Archiv-, Konfigurations- und HTTP-Grenze. Zusätzlich Referenz-/Invariantenvalidator mit strukturiertem Fehlerpfad. Unbekannte Formatversionen erhalten einen Unsupported-Format-Fehler; niemals leer initialisieren und damit überschreiben. Format v1 wird für neue Projekte erzeugt. Es gibt keinen behaupteten Import alter Chat-Entwurfsformate. Migrationstest nutzt eine explizite Testvorgängerversion und verändert nicht still die Produktions-Schemadefinition.

## 5. Speicherung, Revisionen und Recovery

**REQ-017 — Metadaten und Bytes getrennt.** IndexedDB/Dexie enthält `workspaces`, `workspaceViews`, `appSettings`, optional `catalogCache`. Workspace-Zeile umfasst Dokument plus ableitbare Such-/Sortierfelder. Eine Metadatenänderung committen, nicht jeden Tabellenwert. OPFS enthält appverwaltete Dateien unter `workspaces/<uuid>/...`; nie ein vom Nutzer übergebener Zielpfad. Eingelesene Originaldateien werden nicht verändert. [S08, S09]

**REQ-018 — Publish-before-reference.** Schreibablauf für einen neuen Datensatz oder aufbewahrtes Ergebnis:

1. Temporäre Operation registrieren; eindeutige neue Artifact-ID erzeugen.
2. Bytes begrenzt/streamend schreiben, Writer schliessen, SHA-256 und tatsächliche Länge prüfen. Grosse Hashes nicht zwingend als vollständige zusätzliche Kopie im Main Thread berechnen.
3. Vollständiges Kandidatendokument mit neuen Artefaktverweisen erstellen und validieren.
4. Kurze IndexedDB-Transaktion: erwartete `revision` vergleichen, Dokument + neue Revision veröffentlichen.
5. Erst jetzt dauerhaft erfolgreichen Import/Keep anzeigen. Runtime-Hydration ist getrennt davon und kann bei Bedarf wiederholt werden.
6. Bei Fehler vor 4 keine sichtbare fachliche Teilmutation; neue Dateien werden verwaist und sicher später entsorgt.

OPFS und IndexedDB bilden keine gemeinsame Transaktion. Datei-/Netz-/Hasharbeit nicht in eine offen gehaltene IndexedDB-Transaktion legen. Ein fehlgeschlagener Laufzeit-Reload nach erfolgreichem Commit macht gespeicherte Bytes nicht ungeschehen, sondern zeigt einen Retry-Zustand. [S08, S09]

**REQ-019 — Autosave.** Debounce 600 ms, maximal 3000 ms bis Start eines Save bei dauerndem Tippen. Saves pro Workspace serialisieren. In-Memory-Mutationsgeneration und zuletzt gespeicherte Generation getrennt führen. Ein Save von Generation 4 darf eine inzwischen vorhandene Generation 5 weder zurücksetzen noch als gespeichert markieren. `revision` erhöht ausschliesslich das Repository bei erfolgreichem Commit. Datenverlust-/Konfliktfehler niemals still mit Last-write-wins überschreiben.

`Lokal gespeichert` bedeutet nur: Metadaten und als aufbewahrt bezeichnete Bytes wurden erfolgreich veröffentlicht; es bedeutet weder Backup noch Speicherung jedes temporären Ergebnisses. Eigene Markierung `Temporäres Ergebnis`. `Ctrl/Cmd+S` löst in den Editoren Flush aus und verhindert den Browser-Speichern-Dialog. Gesteuerter Workspacewechsel wartet auf Flush. Bei Fehler bleiben Bearbeitung und Fehlermeldung erhalten; Nutzer kann explizit exportieren oder Verwerfen bestätigen. Nicht erst bei `beforeunload` mit asynchronem Speichern beginnen.

**REQ-020 — Locks und Lesemodus.** Pro Workspace exklusiver Writer-Lock über Web Locks, Lebensdauer an die Sitzung gebunden; zusätzliche Revisionsprüfung bei jedem Commit. Lock-Callback muss bis `release()` offen bleiben, nicht unmittelbar aufgelöst werden. Zweiter Tab erhält sofort Lesemodus mit sichtbarem Hinweis, keine neue Editier-/Ausführungssitzung. Kein automatisch stehlender Lock. Lock-Reacquire nach Tab-Schliessen anbieten; verlorene Revision neu laden. Lösch-, Import- und Bereinigungsoperationen beachten dieselben Locks. [S10]

Lesemodus erlaubt gespeicherten Code und bereits gesicherte Resultate anzusehen und zu exportieren. Keine Abfrageausführung, Dateiversionsänderung oder fachliche Mutation. Temporäre Resultate eines fremden Tabs sind nicht zugänglich. Ohne Web Locks bestehende persistente Workspaces nur lesend öffnen; ein neues, ausdrücklich als temporär markiertes Projekt ist möglich. Keine Heartbeat-Scheinlösung als sicherer Ersatz.

**REQ-021 — Wiederherstellung.** Beim Öffnen: Schema und Referenzen prüfen → Lock bestimmen → Metadaten laden → Artefaktinventar prüfen → tote Session-Resultate `unavailable` markieren → vormals `queued/running/cancelling` zu `interrupted` machen → erst bei Bedarf Engines starten. Ein Leser berechnet solche Anzeigen ohne Commit; der nächste Writer persistiert die Normalisierung. Kein automatisches Wiederholen früherer Analysen.

Fehlende oder korrupte Dateien lassen Code und Metadaten lesbar. Betroffene Tabellen erhalten konkrete Fehler mit Wiederherstellen/erneut Importieren; eine neue Datei erzeugt eine neue Version statt historischen Inhalt zu ersetzen. Hashprüfung erfolgt beim expliziten Prüfen, Archivimport und spätestens bevor ein aufbewahrtes Artefakt nach Neustart erstmalig verwendet wird; bis dahin nicht als geprüft bezeichnen. Aktive/in-flight Artefakte und referenzierte Dateien nie als Orphans löschen. Garbage Collection erfordert exklusiven Workspace-Lock und geschlossene Schreiboperationen. Anwendungsfremde OPFS-Einträge niemals berühren.

**REQ-022 — Capability- und Quotafehler.** Schreib-Lese-Lösch-Probe für IndexedDB/OPFS, nicht nur Feature-Property prüfen. Quota-/Denied-/Private-Mode-Fehler sichtbar behandeln. Fehlt Persistenz, nur ausdrücklich bestätigter Sitzungsmodus mit In-Memory-Repository/ArtifactStore und permanentem Status `Nur diese Sitzung`. Kein partieller Persistenzmodus, der Metadaten als dauerhaft und lokale Daten fälschlich als gesichert ausweist. Budgetprüfung und Browser-Speicherschätzung sind Hinweise, keine garantierte Reservierung. Temporärer Modus respektiert dieselben Daten-/Transferlimits. [S09]

**REQ-023 — Duplizieren und Löschen.** Duplikation erstellt neue IDs für Workspace und alle internen Entitäten, remappt Referenzen und kopiert benötigte lokale Bytes unter neuen IDs; keine workspaceübergreifende physische Deduplizierung in V1. Technische Tabellennamen und Benutzer-Code bleiben erhalten. Externe Portal-IDs bleiben extern und werden nicht verändert. Aktive Runtime/Handles werden nicht kopiert. Fehlende temporäre Ergebnisse bleiben fehlend, ausser vorher ausdrücklich gesichert.

Löschen nur mit Bestätigung samt Anzahl Datensätze/Analysen/gesicherter Resultate. Jobs beenden, Sitzung freigeben, unter exklusivem Lock Projekt und View-Metadaten entfernen, danach eigene Dateien löschen. Dateilöschfehler als bereinigbare Reste protokollieren; nicht das fachliche Projekt unbemerkt wiederbeleben. Keine globale `indexedDB.deleteDatabase()`-Abkürzung.

## 6. Datenimport und Dateneinbindungen

**REQ-024 — Importdialog.** Auswahl per Datei-Input und Drag-and-drop; kein ausschliesslicher Einsatz von `showOpenFilePicker`. Erst Vorschau und explizite Bestätigung, dann Projektmutation. Pro Importvorgang eine Datei; weitere Dateien wiederholt hinzufügen. Unterstützt: `.csv`, `.parquet`, Projektarchive separat. Format über Inhalt/Parser prüfen, nicht nur Dateiendung. Leere/defekte Dateien zeigen einen Fehler; gültige Tabellen ohne Datenzeilen sind erlaubt. Maximal 128 MiB Quelldatei in der vorgeschlagenen Defaultkonfiguration, konfigurierbar; dies ist eine Schutzgrenze, kein Performanceversprechen.

**REQ-025 — CSV-Vertrag.** UTF-8 mit/ohne BOM, LF/CRLF, eingebettete Trennzeichen und Zeilenumbrüche in doppelt gequoteten Feldern. Trennzeichen Komma, Semikolon, Tab oder `|`; Kopfzeile an/aus. Doppelte Quote als Quote und Escape. Dezimalpunkt standardmässig `.`, explizit `,` wählbar; keine heuristisch geratenen Tausendertrenner. Leeres ungequotetes Feld ist standardmässig NULL, gequotetes `""` ist leerer String. Andere Nullmarker explizit konfigurierbar; String `NULL` wird nicht ohne Auswahl zu NULL.

Vorschau maximal 200 Datensätze und 200 Spalten. Importoptionen, jede erkannte/geänderte Spaltenbenennung und vollständige logische Typen sichtbar. Identifikatorspalten wie `gemeinde_id` mit führenden Nullen standardmässig VARCHAR oder deutlich korrigierbar; `001` darf nicht still zu `1` werden. Schema-Inferenz bleibt Vorschlag. Vollständiger Import verwendet explizit das bestätigte Schema und strikten Fehlerbetrieb. Ein ungültiger Wert in Zeile 5000 darf nicht unbemerkt zu NULL werden oder die Zeile überspringen. Fehler zeigt betroffene Spalte und Zeileninformation soweit Parser verfügbar.

Bestätigte CSV wird in einen kanonischen Parquet-Datenstand überführt; optionales Original wird standardmässig behalten, und sein zusätzlicher Platzbedarf ist sichtbar. Datentyp-/Rollenmetadaten bleiben im Projekt. Kein stilles Wechseln von Typen je nach später ausgewerteter Zeilenstichprobe. CSV-Importoptionen sind Teil der Herkunft, nicht Teil einer globalen Einstellung.

**REQ-026 — Parquet-Vertrag.** Schema aus Datei lesen, gültige Footer/Datentypen prüfen. Die ausgewählte Datei kann als unverändertes Artefakt übernommen werden; Hash bezieht sich dann auf genau diese Bytes. Nicht unterstützte Spalten dürfen SQL-Zugriff nicht automatisch auf CSV reduzieren. Vorschau kann strukturierte Werte zusammengefasst zeigen, R-Transfer braucht einen eigenen Typvertrag. Keine automatische verlustbehaftete Stringifizierung aller komplexen Datentypen.

**REQ-027 — Versionen und Austausch.** `Daten ersetzen` erzeugt neue DatasetVersion und verschiebt erst nach erfolgreichem Commit `currentVersionId`. Schemaänderungen vor Bestätigung als Diff anzeigen. Vorheriger Datenstand bleibt für historische, noch aufbewahrte Ergebnisse identifizierbar. In-flight SQL/Transfer bindet einen eingefrorenen Stand; Datenersetzung darf diesen nicht ändern. Ein Retry einer unvollständigen Operation publiziert nicht versehentlich zwei Datensätze.

**REQ-028 — Lokale Verfügbarkeit.** Im Datenbestand mindestens unterscheiden: `Referenz`, `Lokal gesichert`, `Wird geladen`, `Nicht verfügbar`. Diese sind abgeleitete technische Zustände, keine fachlichen Workflow-Status wie „in Prüfung“. Eine Portalreferenz belegt erst nach ausdrücklichem `Lokal sichern` oder notwendiger Sicherung für einen dauerhaften Input nachweislich lokale Bytes. Netzwerkcache ist nicht gleich gesicherter Datenstand.

## 7. Integration mit dem bestehenden Datenportal

**REQ-029 — Vorhandenen Vertrag verwenden.** Der geprüfte Portalcode bietet bereits folgende JSON-Endpunkte (Pfad relativ zur konfigurierten Portalbasis): [S03, S04]

```text
/datasets/{entryIdentifier}/explore/context.json
/series/{seriesIdentifier}/issues/current/explore/context.json
/series/{seriesIdentifier}/issues/{issueIdentifier}/explore/context.json
```

`ExploreContext` v4 enthält `datasetId`, Titel, `canonicalUrl`, optionale Lizenz/Änderung sowie `tables` mit `id`, `name`, `title`, `parquetUrl`, Grössenhinweisen und Spalten. Bei Ausgaben ist `datasetId` laut ContextService die konkrete Entry-/Issue-ID. `canonicalUrl` kann dennoch auf `current` zeigen. Deshalb nicht `canonicalUrl` als unveränderlichen Versionsnachweis verwenden.

`ExploreContextV4Adapter` validiert diesen DTO getrennt von der neuen Domain und mappt ihn. Relative `parquetUrl` und `canonicalUrl` gegen die Portalbasis auflösen, nicht gegen die Werkstatt-Origin. Pfadsegmente URI-kodieren. Bei `current` die tatsächlich gelieferte Issue-ID zusammen mit der angefragten Serie speichern; zukünftige Abrufe explizit dieser Ausgabe statt automatisch erneut `current`. Bei einfachen Datasets ohne Ausgabe besteht die Datenstandsidentität aus beobachteter Ressource und Nachweis, nicht aus einer erfundenen Ausgabe-ID.

**REQ-030 — Keine Fernkonfiguration aus dem Katalog.** `execution`, `rLaboratory.runtimeBaseUrl`, Paketlisten und `catalogDatabase.url` aus einem entfernten ExploreContext übernehmen nicht die Sicherheits-/Runtimekonfiguration der Werkstatt. webR, Pakete und Limits kommen aus dem eigenen Deployment. In V1 kein automatisches ATTACH einer fremden `catalog.duckdb` allein aus dem JSON. Spaltenbeschreibungen/Lizenz als Text behandeln, nicht HTML/JavaScript ausführen.

**REQ-031 — Suche ohne erfundene REST-API.** Für „Aus Portal hinzufügen“ gibt es zwei Wege: eine Datensatz-/Ausgabe-URL beziehungsweise ID eingeben oder in einem konfigurierten statischen `CatalogIndex` suchen. Dieser Index ist ein NEUER eigener kleiner Vertrag unter `contracts/catalog.ts`, nicht ein bereits nachgewiesener Endpunkt des Portals. Index optional; ohne Index bleibt URL-/ID-Einstieg funktionsfähig und ein Link zur Suche im Portal wird angeboten. Nicht eigenmächtig HTML-Suchergebnisse scrapen.

Ein Betreiber kann den Index aus dem PublishedCatalog/Publikationsprozess liefern. V1 der Werkstatt braucht keinen neuen Katalogserver. Mitgelieferte Testindexdatei ist synthetisch. Ein Generator für den konkreten produktiven PublishedCatalog kann separat ergänzt werden; er ist nicht Voraussetzung des fertigen URL-/Deep-Link-Datenzugriffs. Produktive Einträge niemals aus Mockups erfinden.

**REQ-032 — Portal-Deep-Link.** Route `/open` nimmt `provider`, entweder `dataset` oder `series` + `issue` und optional `table` an. `issue=current` ist nur beim Einstieg erlaubt und wird vor Speicherung aufgelöst. Keine SQL-/R-Code-Parameter, kein URL-basiertes Auto-Run, keine Tokens. Vorschau zeigt gefundene Tabellen und Auswahl „Neuer Arbeitsbereich“/bestehender Workspace. Nach Hinzufügen per History-Replacement auf Workspace-Route wechseln, sodass Reload nicht erneut importiert. CORS-/404-/leerer Kontext ergibt eine konkrete Meldung; vorhandenes Projekt bleibt unverändert.

**REQ-033 — URL- und Netzvertrag.** Portalbasis ist Betreiberkonfiguration. Unbekannte Provider und unerlaubte Daten-Origins werden abgelehnt. HTTPS in Produktion; HTTP nur explizite localhost-Test-/Entwicklungsprofile. Kein `javascript:`, `file:`, URL-Userinfo oder mitgelieferter Login-Cookie. App-Fetch verwendet `credentials: 'omit'`. Redirects nicht pauschal verfolgen: innerhalb expliziter freigegebener Origins prüfen beziehungsweise ablehnen. Tokenähnliche temporäre URLs nicht in Workspace-Archiven speichern. Bei einer eigenen Origin muss der Betreiber CORS/Range-Zugriff bereitstellen; Clientcode löst fehlende Serverheader nicht durch „no-cors“.

Für öffentliche Parquet-Referenzen kann DuckDB-WASM HTTP-Range-Zugriffe nutzen. Dies muss mit dem tatsächlich verwendeten Server und der Baseline getestet werden. Die App verspricht keine konsistenten Schnappschüsse beliebiger veränderlicher URLs. Erkennt sie Änderung von Hash/ETag/Schemastand, bricht sie den Vorgang mit `SOURCE_CHANGED` ab und verlangt einen neuen Datenstand. Ohne überprüfbare Version Hinweis `Externer Stand nicht eingefroren`; zur verlässlichen Wiederverwendung lokal sichern.

## 8. Analysen, Lauf-Snapshots und Scheduler

**REQ-034 — Gespeicherte Analysen.** Erstellen, umbenennen, bearbeiten, duplizieren, archivieren; SQL und R haben eigene Editoren und Templates. Codeänderungen aktualisieren Analyserevision/updatedAt. Eine neue leere Analyse benötigt keine Tabelle. Editor-Drafts werden autosaved. Monaco-Modelle sind an Analysis-ID gebunden, enthalten unabhängige Undo-/Cursorzustände und werden bei Workspace-Close freigegeben. Ein Ergebniswechsel setzt keinen Editorinhalt zurück.

**REQ-035 — Parameter.** SQL verwendet benannte Scalar-Parameter wie `$jahr`. Parameterdefinitionen als kleine einblendbare Tabelle; Strings, endliche sichere Zahlen, Bool, NULL und explizite int64/decimal/date/timestamp-Textwerte. Werte niemals in SQL zusammenkonkatenieren. Für typisierte Textwerte verlangt das SQL bei Bedarf `CAST($wert AS DECIMAL(...))` oder passenden Typcast; Binder darf sie nicht vorab ungenau in JS-Number umwandeln. R erhält `params` als benannte Liste. Kein Templating mit `${...}`, keine Parameter für Tabellen-/Spaltennamen.

**REQ-036 — Snapshot beim Start.** Analysecode, Revision, Parameter, konkrete Eingaben, Engine-/Paketstände, Codecversion und Zeitbezug werden kopiert, bevor Ausführung beginnt. SQL verwendet in V1 konservativ einen Snapshot aller verfügbaren Workspace-Dateneinbindungen: `inputScope=workspace-snapshot`, `usage=possibly-used`. Das ist keine Behauptung, jede davon sei tatsächlich gelesen worden. Explizite R-Bindungen werden mit `usage=bound` gespeichert. AST-basierte genauere Provenienz darf später zusätzlich ermittelt werden, muss aber nicht für die erste Version erfunden werden.

**REQ-037 — Zustandsautomat.**

```text
queued -> running -> succeeded | failed
queued -> cancelled
running -> cancelling -> cancelled | failed
queued/running/cancelling -> interrupted   # Absturz/Neustart
```

`queuedAt` immer, `startedAt` erst beim tatsächlichen Start; `finishedAt` bei Terminalzustand. Timeout ist `cancelled` mit `stopReason=timeout`, wenn Berechnung wirklich gestoppt wurde; bei Crash `interrupted`. Während `cancelling` kein Erfolg. Trifft Erfolg vor Verarbeitung eines Abbruchwunsches final ein, darf der Adapter `already-settled` melden; der bereits abgeschlossene Lauf bleibt erfolgreich. Der letzte endgültige Status wird genau einmal vergeben.

Fehlgeschlagene/abgebrochene Läufe erzeugen keine als erfolgreich geltenden neuen Resultate. Bereits vorherige erfolgreiche Resultate bleiben bestehen und werden mit ihrem Lauf bezeichnet, nicht als Ausgabe der fehlgeschlagenen aktuellen Abfrage ausgegeben.

**REQ-038 — Ein Scheduler.** Für V1 pro Workspace maximal eine schreibende/ausführende Engineoperation gleichzeitig: SQL-Lauf, R-Lauf, Import, Dataset-Austausch, Transfer oder Snapshot-Sicherung. Editorbearbeitung und bestehende Ergebnisansicht bleiben bedienbar. Keine endlose implizite Jobqueue durch Mehrfachklick; „Ausführen“ während eines aktiven Laufs deaktivieren/Abbrechen anbieten. Paging eines bereits vollständig materialisierten Arrow-Ergebnisses darf nebenher laufen; datenbankbasierte Paging-/Sortieroperationen werden korrekt koordiniert.

## 9. SQL-Ausführung und Ergebnisstabilität

**REQ-039 — Eine DuckDB-Instanz.** SQLRooms besitzt den einzigen Connector der WorkspaceSession. Datenimport, Editor, SQL-Adapter und Ergebnistabelle nutzen ihn. Keine zweite DuckDB in einem zusätzlichen Service oder innerhalb R. Verwaltete Tabellen liegen unter `data.<sqlName>`; optional `data` als Search-Path, sodass unqualifizierte Namen funktionieren. Technische Versionstabellen und Ergebnis-Relationen liegen in reservierten `__dw_`-Namespaces. [S05, S07]

**REQ-040 — V1-SQL-Umfang.** Eine analytische Select-Anweisung, einschliesslich WITH/CTE, Joins, Gruppen, Fensterfunktionen, Unterabfragen und UNION. SELECT ohne Daten ist erlaubt. Mehrfachstatements, DDL/DML, INSTALL/LOAD/ATTACH/DETACH, COPY, SET/PRAGMA und externe Datei-/Netzoperationen über Benutzer-SQL sind nicht Teil von V1. Import/Export darf solche Befehle nur intern und mit appgenerierten Bezeichnern ausführen.

Guard mit einem zur DuckDB-Syntax passenden Parser/Statement-Extractor und geprüften Statement-/Quellenregeln implementieren, nicht mit `startsWith('SELECT')`. P0 prüft, welche Parseroberfläche im installierten Build verfügbar ist; DuckDB-eigene SELECT-Serialisierung oder kompatibler Parser sind zulässig. Unbekannte, nicht sicher einordbare Knoten fail closed. Kommentare, Semikolons in Strings und gequotete Identifier dürfen keine falschen Statementgrenzen erzeugen. Externe Reader-/dynamische SQL-Funktionen im Userpfad ablehnen; Tablefunctions nur aus expliziter Liste (z.B. `range`, `generate_series`, `unnest`) mit Tests. Erlaubte skalare Analysefunktionen können aus nachgewiesenen Builtins aufgebaut werden; seiteneffektfähige/Extensions nachladende Varianten ausschliessen.

Diese Einschränkung schützt den App-Workflow, ist keine Sandbox gegen den Gerätebesitzer und keine spätere Serverautorisierung. Freier SQL-Code ist nach DuckDB-Sicherheitsmodell nicht beliebig harmlos. Engine-Restriktionen/Netzpolicy passend setzen und testen, ohne verwaltete Parquet-Views unbeabsichtigt zu deaktivieren. [S11]

**REQ-041 — Einmal ausführen.** Benutzerabfrage genau einmal pro Lauf ausführen und innerhalb der Ressourcenbudgets materialisieren. Der ResultTableAdapter erhält eine Result-ID/Handle. Paging/Sortieren/Tabwechsel/R-Transfer führen die ursprüngliche Benutzerabfrage nicht erneut aus. Die API liefert Arrow-Tabellen beziehungsweise Batches; nicht zunächst alles über JSON in React laden. [S07]

Erhaltene Zeilen bekommen eine nicht sichtbare stabile Ordinalposition im Ergebnisregister. Paginierung folgt dieser Reihenfolge; sekundäre Sortierung nutzt diese Position als Tie-Breaker. Bei Parquet-Sicherung interne Ordinalspalte in einer internen Speicherung oder äquivalentem Sidecar erhalten, aber weder als Nutzerspalte exportieren noch für R sichtbar machen. Nicht auf eine zufällige relationale Tabellenreihenfolge vertrauen. SQL-ORDER-BY-Reihenfolge des empfangenen Resultates bleibt erhalten.

**REQ-042 — Grenzen ohne Täuschung.** Default maximal 100000 materialisierte Zeilen und 64 MiB logische Ergebnisbytes, SQL-Timeout 30 Sekunden. Ein überprüfter Query-Wrapper darf höchstens N+1 Zeilen empfangen und daraus N mit `coverage=limited` publizieren; tatsächlichen `executedCode` dokumentieren. Kein zusätzlicher unbeschränkter `COUNT(*)` zur vermeintlichen Gesamtzahl. Bei nachträglichem Byteoverflow gesamtes neue Resultat verwerfen, Lauf mit Limitfehler beenden und Ressourcen freigeben. Byte-/Zeilenlimit begrenzt nicht zuverlässig die Datenmenge, die die Engine scannen muss.

Eine Abfrage mit bewusstem `LIMIT 10` und zehn Zeilen ist vollständig bezüglich ihres SQL. Eine appseitige Kürzung ist sichtbar unvollständig. UI zeigt `100000 Zeilen · begrenzt`, nicht eine erfundene ursprüngliche Gesamtzahl. Beispielvorschau, Grid-Seite und tatsächliche Resultatmenge sind getrennt.

**REQ-043 — Echter Abbruch.** Request-ID, AbortSignal und Engine-Epoch verfolgen. Der Adapter wartet auf tatsächliches Settling/Stop oder beendet nach 2000 ms Grace die betroffene Runtime. Nur ein UI-Promise abzulehnen zählt nicht als Stop. Nach Runtime-Reset Epoch erhöhen, alte SQL-Handles invalidieren und verwaltete Daten bei Bedarf erneut binden. R bleibt nur dann erhalten, wenn kein gemeinsamer Session-Close erfolgt. Quellcode enthält bereits einen `cancelSent()`-basierten Pfad; ihn wiederverwenden und mit langen echten Abfragen prüfen, nicht blind als hinreichend ansehen. [S05]

## 10. Resultate, Diagramme und Exporte

**REQ-044 — Resultatsemantik.** Jedes Resultat hat Workspace-ID, Run-ID, Schema/Umfang oder Plotdimensionen, Retention und Materialisierung. Neue Läufe überschreiben keine Ergebnisbytes. Temporäre Ergebnisse stehen bis zum Schliessen/Reset beziehungsweise expliziten Verwerfen zur Verfügung. Nach Neustart bleibt ihre Beschreibung mit `Nicht mehr in dieser Sitzung verfügbar`; kein leeres Grid mit Erfolgssymbol.

**REQ-045 — Dauerhafte Bindung erzwingt Sicherung.** `Aufbewahren`, `Als Datensatz übernehmen`, `Diagramm speichern` und das dauerhafte Binden eines TableResults an eine gespeicherte R-Analyse sichern zuvor den benötigten Tabellenstand. Ohne erfolgreiches Datei+Metadaten-Commit wird die dauerhafte Bindung nicht publiziert. Beim SQL→R-Transfer in eine gespeicherte Analyse ist daher standardmässig das Ergebnis aufzubewahren; UI kündigt dies in einer kompakten Bestätigung an. Im expliziten Sitzungsmodus ist eine temporäre Bindung erlaubt, aber als nicht neustartfest gekennzeichnet.

**REQ-046 — Tabelle.** Grid virtualisiert/paginiert, Standardseite 100 Zeilen, maximal 500 pro Seitenabfrage. Numerische Sortierung numerisch, NULL-Werte sichtbar und nicht mit leerem String verwechselt. BIGINT/DECIMAL nicht durch Number-Präzisionsverlust darstellen. Datumswerte als ISO-Datum, Uhrzeiten nachvollziehbar mit UTC/Offset; technische Metadaten in aufklappbaren Details. Duplizierte Ergebnis-Spaltennamen deterministisch normalisieren und Warnung anzeigen; Originalbezeichnungen im Schema behalten.

**REQ-047 — Diagramme.** Balken, Linie und Scatter; X/Y und optional Kategorie wählen, Titel aus Ergebnis/Analyse. Kein Dashboard-Builder. Chart bildet das Resultat ab, nicht eine heimlich andere Aggregation. Line sortiert X explizit, Bar übernimmt Ergebnisordnung. Mehr als 5000 Punkte oder 100 Kategorien verlangen Aggregation/Filter in SQL; nicht still Top-N oder zufälliges Sampling. NULL-Y nicht als 0 zeichnen. Gespeicherte Visualization bezieht sich auf konkretes aufbewahrtes TableResult. R-Plot wird separat als PNG gespeichert.

**REQ-048 — Ergebnisexport.** CSV UTF-8, konfigurierter Separator (Default `;`), Quote `"`, Punkt als Dezimalzeichen, LF; Dateiname bereinigt und nicht Pfad. Parquet typisiert ohne interne Ordinalspalte. PNG nur echte Grafikbytes. Export des vollständigen bezeichneten Ergebnisses, nicht der sichtbaren Grid-Seite. Bei `coverage=limited` vor Export deutlicher Hinweis, ebenso bei Verlust von CSV-Typinformation.

CSV „Für Tabellenkalkulation entschärfen“ optional und standardmässig aus: gefährliche textuelle Formelpräfixe kennzeichnen/entschärfen und sichtbar sagen, dass diese Exportoption Datenrepräsentation verändert. Maschineller Standardexport verändert Strings nicht still. Exportfehler/Downloadabbruch ist kein erfolgreicher Datei-Download.

## 11. R-Laufzeit, Skripte und SQL–R-Transfer

**REQ-049 — Lazy R-Lifecycle.** webR startet erst bei Bedarf und gehört zur WorkspaceSession, nicht zum sichtbaren RPanel. SQL→R→SQL beendet R nicht. Initialisierung ist idempotent, parallel eintreffende Starts teilen ein Initialisierungspromise. Fehlende Pakete/WASM-Dateien sind nachvollziehbare Init-Fehler mit Retry. Start und Dispose berücksichtigen React StrictMode. Baseline webR wird selbst gehostet; kuratierte Paketliste aus vorhandenem Lock/Mirror übernehmen. In V1 kein UI für beliebige CRAN-Installationen. [S01, S12, S13]

**REQ-050 — R-Umgebungen.** Default `workspace-session`: Skripte nutzen ein dediziertes Workspace-R-Environment und können dort bewusst Objekte weiterverwenden. Optional `fresh-environment`: pro Lauf neues Environment mit expliziten Inputs/params. Das ist kein eigener R-Prozess; Paket-, Options- und globale Seiteneffekte sind weiterhin möglich. Die App behauptet hierfür keine vollständige Isolation.

Ein `RScope` und jede `RObjectRef` enthalten Session-ID und R-Epoch. Ergebnis-/Objektansichten zeigen den Scope des letzten gewählten Laufs. Temporäre Fresh-Scopes müssen erhalten bleiben, solange ihre Objekte ausgewählt oder übertragen werden; danach freigeben. Maximal fünf nicht mehr aktive Fresh-Scopes in der History, explizit gesicherte Tabellen/Grafiken vorher extrahieren. Ein Name wie `vergleich` allein identifiziert kein Objekt über Reset oder Scopewechsel hinweg.

**REQ-051 — Ausführung und Konsole.** R-Code vollständig oder ausdrücklich markierter Auswahltext ausführen; Snapshot enthält genau ausgeführten Text und Auswahlhinweis. Editorrevision bleibt separat. Konsole in V1 Ausgabeansicht, kein zusätzlicher unprotokollierter REPL-Eingabekanal. stdout, stderr, warnings, messages und Fehler getrennt darstellen. Maximal 2000 Zeilen bzw. 1 MiB sichtbarer Logtext; Begrenzung anzeigen. Maximal zehn temporäre Plotbilder je Lauf, Überlauf explizit melden. Fehlgeschlagener Lauf darf kein altes Plotbild als neues Ergebnis ausgeben.

Ist der letzte erfolgreich ausgewertete Ausdruck ein Dataframe, darf er als temporäres TableResult erfasst werden. Weitere Dataframes werden explizit über die Objektliste übernommen. Eine solche spätere Aufnahme erzeugt einen `r-object-capture`-Lauf mit Sitzungsherkunft; nicht behaupten, ein älterer Skriptlauf hätte den aktuellen Objektstand exakt produziert. R-Capture ohne erneutes Ausführen des Skripts.

**REQ-052 — SQL nach R.** UI-Aktion auf TableResult: R-Analyse wählen/anlegen → Variablenname (Default `daten`) → Transferplan mit Zeilenanzahl, Grösse und Konvertierungsbericht → nach allfälliger Bestätigung Ergebnis sichern und InputBinding speichern → Dataframe in passendem Scope bereitstellen → R-Seite öffnen. Kein R-Skript automatisch starten. Bei vorhandenem Variablennamen explizite Ersetzung bestätigen. Die Übernahme bezeichnet das komplette Resultat, nicht die Grid-Seite. `coverage=limited` wird als Einschränkung mitübernommen.

**REQ-053 — R nach SQL.** Dataframe im richtigen Scope auswählen → Transferplan/Typbericht → Namen bestätigen → begrenzte typisierte Aufnahme → neuer TableResult/Capture-Lauf → Parquet-Artefakt und neue Dateneinbindung veröffentlichen. Ergebnis steht als `data.<sqlName>` zur Verfügung. Bei „bestehenden Datensatz ersetzen“ neue DatasetVersion, niemals unbemerkt bestehende Tabelle überschreiben. Abbruch vor Publikation lässt keinen halben Datensatz zurück. Diese Aktion synchronisiert keine beliebigen R-Objekte automatisch.

**REQ-054 — Typvertrag.** Transportiert werden spaltenorientierte Daten plus vollständiges Schema und Missing-Maske. `validity=0` heisst NULL/NA; `validity=1` kann gültiges NaN oder Infinity enthalten. Vorhandener JSON-Mapper ist Ausgangsbasis/Regressionstest, aber die V1-Zielimplementierung muss die folgenden Regeln erfüllen. Arrow IPC direkt in R ist ausdrücklich keine V1-Voraussetzung. Explizite R-Konstruktoren/vektorisierte Konvertierung benutzen und anhand des tatsächlich verfügbaren webR-Builds prüfen. [S12]

| Eingabetyp | R-Repräsentation / Rückweg |
|---|---|
| BOOL | logical mit echtem NA |
| int8/int16/int32 ohne R-NA-Sonderwert | integer |
| int32-Wert −2147483648 | numeric oder schemaerhaltender Text; niemals NA erzeugen |
| uint32 / int64 | numeric nur bei nachgewiesener exakter Darstellbarkeit aller Werte bis ±(2^53−1); sonst character mit Herkunftstyp |
| uint64/hugeint | character, ausser explizit sicher nachgewiesener kleiner Wertebereich |
| DECIMAL(p,s) | verlustfreie Dezimalzeichenkette + Schema; kein stilles double |
| VARCHAR/Identifier | character, führende Nullen/Unicode/Leerstring erhalten |
| DOUBLE/FLOAT | numeric, NA getrennt von NaN/±Inf |
| DATE | R Date, taggenau, keine lokale Zeitzonenverschiebung |
| TIMESTAMP/TIMESTAMPTZ | POSIXct UTC nur bei verlustfreiem erforderlichem Wertebereich/Precision; sonst ISO-Text + Schema + Warnung |
| R factor | Werte als VARCHAR; Levels/ordered in Schema-Metadaten erhalten |
| R Date / POSIXct | DATE / geeigneter TIMESTAMP; UTC/Einheit explizit |
| BLOB, Listen, Structs, komplexe Geometrie, R complex | in V1-R-Transfer ablehnen mit Spaltenliste; gezieltes Weglassen/Casten durch Nutzer möglich |

Tabelle ist Codec-Vertrag, keine Behauptung, R unterstütze alle DuckDB-Typen nativ. Schemaannotationen sind kein Freipass für einen Blind-Cast zurück: hat R einen character-Wert einer DECIMAL-/Integer-Spalte geändert, muss jeder Rückwert validiert werden. Ungültig bedeutet Ablehnung oder ausdrücklich bestätigte Rückübernahme als VARCHAR, nicht NULL und nicht Rundung. Precision-Loss standardmässig abgelehnt; V1 braucht keinen „trotzdem ungenau“-Modus. Warnungen bei sicherer Repräsentationsänderung sind zulässig. Nullable, Zeilenreihenfolge, Spaltenreihenfolge sowie Tabellen mit null Zeilen müssen erhalten bleiben.

**REQ-055 — Transferlimits und Ressourcen.** Warnung ab mehr als 10000 Zeilen, harte Grenze 100000 Zeilen bzw. 64 MiB geschätztem Transferpayload. Keine stille Teilmenge. Vor teuren Konversionen grob planen, während der Konversion tatsächlich mitzählen und bei Overflow abbrechen. Mehrere WASM-Heaps und temporäre Kopien bleiben möglich; kein Zero-Copy-/Peak-RAM-Versprechen. Ein TransferPlan ist an konkrete Source-ID, Version, Scope und Epoch gebunden. Ändern sie sich, Plan verwerfen und neu erstellen. Zwischen Planung und Commit Scheduler-/Lease-Regeln beachten.

**REQ-056 — R-Abbruch.** `PostMessage` bleibt die migrationsnahe Baseline. Die Dokumentation nennt dafür kein reguläres Interrupt. Dann bedeutet Abbrechen: R-Worker beenden, neue R-Epoch, alle ungesicherten R-Scopes/Objekte invalidieren. Ein sichtbarer Hinweis erklärt den Verlust. Bei funktionierendem SharedArrayBuffer-Kanal reguläres Interrupt zuerst versuchen und nach Grace-Zeit gegebenenfalls ebenfalls Reset. Default Laufzeitlimit 60 s; Timeout folgt demselben echten Stop-Pfad. [S13]

Reset-Button bestätigt bei vorhandenen ungesicherten Objekten und beendet nur R, nicht gespeicherten Code/Daten oder laufzeitgültige SQL-Ergebnisse. Verlorene Objekte nicht in der Liste als aktiv stehen lassen. Shelters, R-Proxies, ImageBitmap, temporäre Dateien, Object-URLs und scopes bewusst freigeben. Wiederholtes Öffnen derselben Seite darf keine neue Runtime erzeugen.

**REQ-057 — Herkunft ehrlich anzeigen.** Sitzungsmodus ist `session-dependent`. Fresh-Environment plus deklarierte Inputs kann `declared-inputs` sein, ist aber kein Reproduzierbarkeitssiegel. Freier Code kann Zufall, Zeit und nicht protokollierten globalen Zustand verwenden. Seed, locale, TZ und tatsächliche Paketstände erfassen, soweit relevant; nicht erfundene Versionsangaben ins Ergebnis schreiben. Bestehende Resultate werden bei Eingabeänderung als auf älterem Stand erkennbar, nicht heimlich neu berechnet.

## 12. Frontendzustand und Sitzung

**REQ-058 — Ein Domainzustand.** Kleiner AppStore für Einstellungen und Projektübersicht; genau ein WorkspaceStore mit eigenen Slices `workspace`, `data`, `analyses`, `executions`, `results`, `ui` plus benötigten SQLRooms-Slices. Gespeicherter Code gehört der eigenen Domain. Kein paralleler unabhängiger SQLRooms-Queryspeicher. Runtime-Handles in einem SessionResultRegistry, nicht im persistenten Store. Komponenten abonnieren kleine Selektoren; Tippen im Editor rendert nicht das komplette Datengrid neu.

**REQ-059 — Session-Lebensdauer.** Ein WorkspaceProvider oberhalb der Unterrouten besitzt die Sitzung. Aktiver Workspace pro Tab maximal einer; Liste/Startseite startet keine Engines für alle Projekte. Bei Workspacewechsel: laufenden Job sichtbar abbrechen/bestätigen → Flush → Dispose → neue Session-ID → neue Verbindung nach Bedarf. Antworten tragen Session-ID/Epoch/Run-ID; späte Ergebnisse alter Sitzungen werden ignoriert und freigegeben. Bei erfolglosem Flush nicht trotzdem navigieren. Vorangekündigtes Verwerfen bleibt explizite Nutzeraktion.

React-Effekt-Cleanup, Routerwechsel, Retry und Reset müssen idempotent sein. Fehler bei Dispose nicht als erfolgreicher Speicherabschluss darstellen; Ressourcenreinigung läuft bestmöglich und wird protokolliert. Unterstützte Portverträge unter `contracts/ports.ts` dürfen projektspezifisch aufgeteilt werden, nicht ohne Tests semantisch aufgeweicht.

## 13. Seiten, Navigation und Interaktionen

**REQ-060 — Routen.**

```text
/                              -> /workspaces
/workspaces
/workspaces/:workspaceId
/workspaces/:workspaceId/data
/workspaces/:workspaceId/sql/:analysisId
/workspaces/:workspaceId/r/:analysisId
/settings
/open                          # Portal-Einstieg
```

Falsche Kombination Workspace/Analysis oder SQL-/R-Typ ergibt kontrollierte Nichtgefunden-Seite; nicht ein anderes Projekt laden. IDs in URLs, Anzeigenamen nicht als Identität. Browser Back/Forward erhält Sitzung, solange Workspace-ID gleich bleibt. Detaillinks unter konfiguriertem Base-Path funktionieren nach Reload.

**REQ-061 — Workspace-Übersicht.** Standard ist eine einfache Liste mit Name, Daten/Analysenzahl, zuletzt bearbeitet und Kontextmenü. Primäre Aktion „Neuer Arbeitsbereich“, sekundär „Projekt öffnen“. Keine identische zweite Liste „Zuletzt geöffnet“ direkt darunter. Ein leerer Zustand erklärt in einem Satz die zwei nächsten Aktionen. Keine Demo-Projekte automatisch in produktivem Profil. Eine Datenimportaktion in der Übersicht legt nach bewusster Auswahl einen neuen Workspace an oder verlangt einen Zielworkspace, nicht einen globalen unsichtbaren Datenspeicher.

Workspace-Detail enthält Datenliste und gespeicherte Analysen, keine Status-/Besitzer-/Aktiv-Kacheln ohne fachlichen Zweck. „Daten hinzufügen“ bietet Datei oder Portal. Neu SQL/R öffnet einen benannten Entwurf im Workspace. Kontextabhängige Navigation SQL/R öffnet zuletzt verwendete Analyse oder legt eine an. Ohne aktiven Workspace sind diese Ziele nicht scheinbar globale Editoren.

**REQ-062 — SQL-Arbeitsfläche.** Eine kompakte Zeile mit Analysename/Speicherzustand, Toolbar „Ausführen“, „Speichern“, weitere Aktionen im Menü. Daten-/Schemapanel einklappbar; keine ständige rechte Abfrageinfo-Spalte. Editor oben, Ergebnistabelle unten, Trennbalken vertikal verstellbar. Statuszeile fasst Laufzeit, tatsächliche Zeilen und Begrenzung zusammen. Ergebnisaktionen „Aufbewahren“, „In R“, „Exportieren“ am Resultat. Metadaten/Parameter in Drawer oder einblendbarem Abschnitt, nicht dauerhaft neben der Arbeit.

**REQ-063 — R-Arbeitsfläche.** Editor und Plot/Tabelle nebeneinander, Breite verstellbar; Konsole unten einklappbar. Objekt-/Inputliste als schmaler ausblendbarer Bereich. Bindungen, Scope, Datenstand und Reset erreichbar, aber keine grosse „Aktiver Dataframe“-Kachel. Auswahl eines Objekts zeigt echten Zustand. Plot-Vollbild und Download verfügbar. Kein separater KI-/Hilfepanel in V1.

**REQ-064 — Einstellungen.** Nur Editor-Schriftgrösse (12–22 px), Zeilennummern, Zeilenumbruch, Standard-Seitenleistenstatus; Speicherverbrauch/Status anzeigen sowie bewusste Projekt-/Cachebereinigung. Helles Theme ist V1-Standard. Kein allgemeiner Security-Schalter, keine Benachrichtigungsplattform, keine ClickHouse-Loginmaske. Nicht implementierte Theme-/Profileoptionen nicht anbieten. Layoutzustand separat von Workspace-Domain speichern.

## 14. Visueller und Bedienvertrag

**REQ-065 — Arbeitsfläche vor Dekoration.** Kein Hero-/Skylinebild, keine Slogans, keine Eyebrow-Überschrift „KANTON SOLOTHURN“ über dem Inhalt, keine dauerhafte Erklärung „Was ist ein Arbeitsbereich?“. Offizielles Logo als Original-Asset aus dem vorhandenen kantonalen Assetbestand verwenden, nicht aus generierten Mockups nachzeichnen. Proportionen und Schutzraum wahren. Schrift nur mit zulässigem Asset/License-Kontext, sonst seriöser Systemfont-Fallback; keine Fontdateien aus diesem Spezifikationspaket erwarten. Die Mockups sind Ideen, nicht die Quelle für echte Logos oder echte Daten.

**REQ-066 — Geometrie bei 1440×900 CSS-Pixeln.** Browser-Chrome nicht Teil der Messung. Kompakte App-Kopfzeile Ziel 56 px; Analysentabs/Toolbar zusammen höchstens weitere 88 px, ausser notwendiger zugänglicher Zoomansicht. Sidebar einklappbar, collapsed 48–56 px, expanded 200–224 px. Auf SQL/R beim ersten Öffnen collapsed. Mit geschlossenem Schema-/Info-Panel stehen mindestens 90 % der Breite rechts neben der Iconleiste dem Arbeitsbereich zur Verfügung. Editor+Ergebnis beziehungsweise Editor+Plot+Konsole belegen mindestens 75 % der Viewporthöhe. Keine ständige rechte Infospalte zur Erfüllung künstlicher Dashboard-Symmetrie.

Panels besitzen sinnvolle Minima (SQL-Editor 180 px, Resultat 220 px bei 900px-Höhe), User-Anpassung und „Arbeitsfläche zurücksetzen“. Bei kleineren Höhen Scrollen/Tabansichten anbieten statt Inhalte zu überlagern. Am 1280×800-Test kein horizontaler Seiten-Scrollbar durch App-Chrome; innerhalb des Code-/Tabellengitters zulässig. Tabellenzeilen nicht als grossflächige Karten gestalten. Ruhige Grautöne, Weiss, kantonales Rot sparsam für primäre Aktionen/Auswahl.

**REQ-067 — Tastatur und Semantik.** Buttons echte Buttons, Dialog-Fokus gefangen und beim Schliessen zurückgegeben, Escape schliesst nicht-destruktive Drawer/Dialoge. Iconbuttons mit zugänglichen Namen und Tooltips. `Ctrl/Cmd+Enter` führt aktuelle Analyse/markierten Code aus; `Ctrl/Cmd+S` speichert. Splitter fokussierbar und mit Pfeiltasten bedienbar. Sichtbarer Fokus, Labels, ausreichender Textkontrast (Ziel 4.5:1), Statusmeldungen angemessen über Live-Region, nicht bei jedem Typed-Character. Datum/Zahlen deutsch-schweizerisch anzeigen, persistierte Werte maschinenlesbar unverändert.

## 15. Projektarchive

**REQ-068 — Archivformat.** `.dwproj` ist ZIP mit `manifest.json` gemäss `contracts/archive.ts`, Formatversion 1 und optional `artifacts/<id>.<ext>`. `recipe` enthält Projektdefinition/Quellenherkunft ohne grosse Bytes; `with-data` zusätzlich lokal gesicherte und referenzierte benötigte Artefakte. Keine Cookies, Zugangsdaten, Runtime-Handles, fremden Benutzerprofile oder Betreiberkonfiguration. Archivexport führt nie Code aus.

Vor Export Zusammenfassung: enthaltene Datenstände/Resultate, Dateigrösse soweit bekannt, externe Referenzen und fehlende lokale Quellen. Bei `with-data` werden temporäre nötige Resultate nach Bestätigung gesichert; noch externe Parquet-Quellen werden nur bei gewähltem „Externe Quellen ebenfalls sichern“ heruntergeladen. Fehlen Bytes, ist das Archiv ausdrücklich nicht vollständig offline verwendbar. Eine Bezeichnung „Mit Daten“ allein darf diese Auslassungen nicht verstecken.

**REQ-069 — Archivimport und ID-Remapping.** Erst inspizieren, Version/Limits/Pfade/Hashes prüfen und Codehinweis zeigen; nach Bestätigung neue Workspace-ID, neue interne IDs und neue appgenerierte Artefaktpfade. Remapping gilt für alle Dataset-/Version-/Analysis-/Run-/Result-/Visualization-/Artifact-Referenzen einschliesslich Snapshots und Herkunft. Externe Portal-IDs bleiben unverändert. SQL/R als Text wird nicht über globale Stringersetzung verändert. Tabellenaliase bleiben stabil; deshalb muss Code nicht intern auf neue UUIDs angepasst werden.

Bei ausgelassenen Artefakten: dataset backing explizit `missing`, Originalartefakt-Referenz entfernen, ResultMaterialization `unavailable:recipe-import`. Fehlende historischen Metadatenreferenzen bleiben nicht dangling: Metadatensätze von Lauf/Resultat/Version erhalten. Artifact-Records ohne mitgelieferte Bytes werden beim Import nicht als lokal existent veröffentlicht. Runtime-Konfiguration des Archivs wird nicht akzeptiert. Bei Importfehler alter Workspace unverändert; temporäre Dateien bereinigbar, kein halbfertiges Projekt sichtbar.

**REQ-070 — Archivschutz.** Default maximal 128 MiB komprimiert, 512 MiB expandiert, 128 MiB pro Eintrag, 4096 Einträge; darüber kontrollierte Ablehnung. Zusätzlich auffällige Kompressionsverhältnisse >200:1 bei Einträgen >1 MiB ablehnen. Grenzen beim Entpacken tatsächlich mitzählen, nicht nur ZIP-Headern vertrauen. Relative Pfade kanonisieren: keine `..`, absoluten Pfade, Laufwerkspräfixe, Backslash-Traversal, NUL, Symlinks oder doppelte normalisierte Einträge. Nur manifestierte reguläre Dateien erlauben. Alle Hashes/Längen vor Veröffentlichung prüfen. Fremder Code bleibt Text, kein Preview-Autostart oder Makro.

## 16. Sicherheit und Vertrauensgrenzen

**REQ-071 — Keine implizite Codeausführung.** Laden von Workspace/Archiv, Quelle, Tabellenzelle, Beschreibung oder Rezept führt keinen enthaltenen Code aus. Ein vorgegebenenes SQL-/R-Beispiel wird erst nach Benutzer-Ausführen gestartet. Kein `dangerouslySetInnerHTML` für Metadaten/Log-/Tabelleninhalte, kein `eval` für Projektkonfiguration, kein frei nachladbares JS-Plugin. Query- und R-Ausführung sind eine bewusste Funktion für vertrauenswürdigen Benutzer-Code; sie sind keine abgeschottete Mehrbenutzer-Sandbox.

**REQ-072 — Netz- und Diagnoseminimierung.** In V1 keine Telemetrie, externen Fonts, Analytics-Scripts oder Modell-APIs. Notwendige Daten-/Paketabrufe sichtbar und auf Betreiberkonfiguration beschränkt. Fehlerlogs enthalten Run-/Workspace-IDs, Phase, Laufzeit und technische Fehler, nicht automatisch vollständige Tabellenwerte oder Dateien. Kein SQL/R-Text in Server-Access-Log-URLs. Export-/Fehlerberichte nur explizit; Datenbestand bleibt beim Nutzer. Sicherheitsmassnahmen schützen nicht vor absichtlich geändertem Code/DevTools des Gerätebesitzers.

## 17. Runtime-Konfiguration, Build und Auslieferung

**REQ-073 — Runtime-JSON.** `runtime-config.json` gemäss `contracts/runtime-config.ts` beim Start streng validieren. Nur Betreiber setzt Portalbasen, Daten-Origin-Allowlist, Paket-/WASM-Pfade und Limits. Relative App-Assets gegen `appBasePath`, relative Portalressourcen gegen Providerbasis auflösen. Keine echten produktiven Endpunkte aus Beispielwerten ableiten. Configfehler zeigen Diagnose, keine globale permissive Fallback-Konfiguration.

Mitgelieferte Limits sind konkrete konservative Startwerte für Entwicklung und Pilot, keine Messresultate. Agent darf sie nur mit dokumentiertem Benchmark/ADR ändern, nicht zur Umgehung eines fehlgeschlagenen Tests. UI-Abbruch muss unabhängig von langen Berechnungen noch bedienbar bleiben.

**REQ-074 — Assets und Container.** Reproduzierbarer Vite-Build, versionierte lokale DuckDB-/Monaco-Worker, WASM/Extensions, webR und kuratierte Pakete. Bestehende Mirror-/Precompression-Skripte übernehmen/anpassen. Node nur zum Bauen; statischer Server im Runtime-Container, nicht zusätzlicher Node-API-Server. Container non-root-fähig, Port 8080, arbitrary OpenShift UID, nur erforderliche temporäre Schreibverzeichnisse. Keine geheimen Build-Args oder Browsercredentials. Lockfiles und Imagebasis/Digests dokumentieren.

SPA-History-Fallback nur für App-Navigation, nicht für fehlende `.wasm`, `.js`, JSON-Konfiguration oder Pakete: diese müssen 404 statt HTML liefern. Korrekte MIME-Typen; gehashte Assets immutable-cachebar, HTML/Runtimeconfig revalidiert. Root- und `/lab/`-Base-Path testen. CORS/Range-/Content-Length/Content-Range-Verhalten mit echter Browserumgebung und Test-HTTP-Server prüfen. Dev-Proxy ist kein Produktions-Bypass.

**REQ-075 — Kommunikations-/CSP-Profile.** Baseline `PostMessage` ohne SharedArrayBuffer-Zusage. Zusätzlich Profil `auto` mit geeigneten COOP/COEP-Headern und getesteten CORS/CORP-Ressourcen. Service Worker nicht für einen versteckten Interrupt-/Offlinehack einführen. Kein PWA-Offline-Neustart-Versprechen in V1: nach geladenen Assets offline mit lokal gesicherten Daten arbeiten ist etwas anderes. CSP aus tatsächlich benötigten Worker-/WASM-/Style-Anforderungen ableiten; keine pauschale `*`-Freigabe. Erforderliches `wasm-unsafe-eval`, blob-Worker oder dynamische Styles begründet und getestet einsetzen, nicht blind behaupten, `script-src 'self'` reiche für jede Baseline. [S13, S14]

## 18. Fehlerdarstellung und Beobachtbarkeit

**REQ-076 — Strukturierte Fehler.** Codes aus `contracts/ports.ts`; gleiche Errorfamilie in UI, Service und Tests. Benutzertext verständlich, Details aufklappbar. Mindestens separate Meldungen für Quelle nicht erreichbar, ungültiges Format, unerlaubtes SQL, Typ nicht unterstützt, Quota, fehlendes Artefakt, Versionskonflikt, Timeout, Runtime-Reset und Archivfehler. Retry ist nur bei tatsächlich sinnvoll wiederholbarem Vorgang angeboten. Ein Toast allein genügt nicht bei verlorener Persistenz oder schreibgeschütztem Projekt.

Laufstatus/Adapterversion/Session-ID für lokale Diagnose verfügbar. Performance-Messpunkte: Shellstart, Workerinit, Import, SQL, R-Init, Transfer, R-Lauf, Keep/Commit, Reopen. Keine Tool-Telemetrie nach aussen. Beim User-Support Export eines Diagnoseberichts ohne Daten standardmässig; sichtbare Auswahl, wenn Code aufgenommen wird.

## 19. Tests, Definition of Done und Abnahme

**REQ-077 — Testpyramide und reale Engines.** Domain-/Applicationtests mit Fake-Ports für Fehlerstellen; Storage-/Locktests in Browser; zentrale Integrations- und E2E-Tests mit echten DuckDB-WASM- und webR-Instanzen. Mocks sind kein Ersatz für den Golden Path. Keine manuell gesetzen „success“-Statuswerte in Produktion. Akzeptanzfälle in `ACCEPTANCE_TESTS.md` implementieren und auf Requirements zurückverweisen. Explizit nachweisen: tatsächlicher Abbruch, Run-Snapshot unter Editoränderung, stabiler Paging-/Random-Resultatstand, kompletter Transfer jenseits einer Gridseite, Reload ohne Code-Autostart und Archive-ID-Remapping.

Synthetische Beispieldaten unter `fixtures/` sind keine echten Gemeinde-/Statistikdaten. Die festen Sollwerte wurden für das Spezifikationspaket rechnerisch geprüft. Der Agent muss sie zusätzlich mit der echten Zielruntime reproduzieren. Fehlende Netzwerk-/Browserfähigkeiten als nicht getestet/blockiert melden; nicht Tests deaktivieren und „grün“ berichten.

**REQ-078 — Browser-/UI-Nachweis.** Automatisierte Suite mit gepinntem Chromium und Firefox, Engine-/Storage-Smoketests zusätzlich WebKit. Echter Safari-Pilot dokumentiert macOS-/Browserstand, nicht WebKit automatisch mit Safari gleichsetzen. Keine Aussage „alle aktuellen Browser unterstützt“, bevor die Matrix belegt ist. Einschränkungen pro Funktion sichtbar; voll unterstützter V1-Release braucht bestandenen Golden Path in den zugesicherten Browsern. Renderchecks bei 1440×900 und 1280×800; Screenshots und Geometriemessungen nach REQ-066. Keine Pixel-Goldenwerte aus generierten Mockups.

**REQ-079 — Prüfbefehle.** Zielrepository stellt bereit:

```text
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm run verify
```

`verify` bündelt typecheck/lint/unit/build/integration/e2e in dokumentierter Reihenfolge und beendet bei Fehlern mit nonzero. Ein `test:integration` ohne echte Browser-/WASM-Prüfung ist nicht ausreichend. Zusätzliche `fixtures:build`, `assets:prepare` und `test:browser-matrix` sind erlaubt; deren Netzwerk-/Buildvoraussetzungen dokumentieren. Testfixtures nie still von veränderlichen öffentlichen Statistiken beziehen. CI startet statischen Testserver, installiert gepinnte Browser und liefert Testergebnisse/Screenshots als Artefakte. Globale Entwicklerinstallation ist keine versteckte Voraussetzung.

**REQ-080 — Lieferqualität.** Dokumentierte Start-/Build-/Deployanleitung, Dependency-/Lizenzinventar, Runtimeconfig-Beispiel, Testergebnisse, bekannte Einschränkungen, Portalmapping und Backuphinweis. Keine kritischen TODOs, unimplementierten produktiven Methoden oder deaktivierten Abnahmetests unter einem „fertig“-Label. Bereits existierende Tests aus übernommenen Komponenten erhalten/anpassen. Jede Phase endet mit kleinem überprüfbarem vertikalem Ergebnis und sachlichem Bericht; kein Claim über ausgeführte Tests ohne tatsächlichen Befehl/Exitstatus.

## 20. Erweiterbarkeit ohne Vorwegnahme

ClickHouse kann später einen zusätzlichen SQL-Port hinter einer autorisierten Server-API erhalten. Serverablage kann ein WorkspaceRepository ergänzen. KI nutzt dieselben Application-Services, nicht einen geheimen Parallelpfad. Diese Anschlussstellen dürfen benannt und im Code schmal gehalten werden. V1 bekommt dafür weder Fake-Connector noch Auth-Flags, Platzhalterchat oder generischen Engine-Marktplatz. Ein lokaler Query-Guard ist keine serverseitige Zugriffskontrolle; SQL-Dialekte bleiben unterscheidbar.

## 21. Wichtigste Präzisierungen gegenüber dem Architekturentwurf

Diese Spezifikation macht bislang offene Details verbindlich: Portalintegration nutzt vorhandenes Context-v4-JSON; Suchindex ist optional und ausdrücklich neu. Dauerhafte Resultatinputs erzwingen Sicherung. Löschsemantik nutzt Tombstones für die Herkunft. Ein SQL-Lauf protokolliert zunächst konservativ den verfügbaren Workspace-Datenstand statt erfundener exakter Lineage. R-Objekte sind Scope-/Epoch-gebunden. Projektarchive können fehlende Daten ausdrücklich darstellen. SQL-/R-Arbeitsflächen erhalten messbare Platzvorgaben. Limits sind Pilotdefaults und kein Benchmark. V1 hat kein Benutzerprofil und keine Freigaben trotz früherer Mockups.

## 22. Quellen

Quellenkennungen [S01] bis [S14] sind in `docs/SOURCES.md` mit konkreten Dateien/URLs und Prüfstatus aufgelöst. Die Softwareanforderungen selbst sind vorgeschlagene Produktentscheidungen. Die referenzierten Primärquellen begründen bestehende Integrationspunkte und technische Grenzen, nicht einen Anspruch, diese gesamte Anwendung sei bereits vorhanden.
