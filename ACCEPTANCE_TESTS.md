# Abnahmetests — Datenwerkstatt V1

72 Szenarien mit stabilen IDs. Alle Fälle sind für den vereinbarten V1-Umfang verbindlich; die Testebene nennt den mindestens benötigten Nachweis. „Fault“ bedeutet kontrollierte Fehler-Injektion an einem Port, zusätzlich zu den positiven echten Browserpfaden.

Für Wiederholbarkeit: isoliertes Browserprofil pro Testgruppe, feste Fixtures, UTC, gepinnte Assets/Engines; dynamische Zeiten/UUIDs semantisch prüfen. Native Referenzrechnungen ersetzen keine DuckDB-WASM-/webR-Prüfung. Bilder auf Vorhandensein/Dimension/Inhalt prüfen; exakte Pixelsnapshots nur mit gepinnter Renderingumgebung.

## Szenarien

### AT-001 — Baseline und reproduzierbare Toolchain
**Requirements:** REQ-001, REQ-002, REQ-006, REQ-007 · **Phase:** P0 · **Ebene:** Build/Integration

**Gegeben:** Ein frischer Checkout ohne globale Projektdependencies.
**Wenn:** Lockfile installieren, Toolchain/Exports prüfen und Minimalbuild starten.
**Dann:** Versions-/Commitnachweis liegt vor; keine latest-Dependencies, keine geratenen API-Imports; echte DuckDB-/webR-Smokes laufen oder sind ausdrücklich blockiert.

### AT-002 — Modulgrenzen und genau ein Connector
**Requirements:** REQ-008, REQ-009, REQ-010, REQ-058, REQ-059 · **Phase:** P0 · **Ebene:** Unit/Browser

**Gegeben:** Instrumentierte Factory für Engine und WorkspaceStore.
**Wenn:** Workspace und mehrere SQL-/R-Seiten wiederholt öffnen, auch unter React StrictMode.
**Dann:** Domain importiert keine UI-/Browseradapter; genau eine DuckDB-Factory pro aktiver Session, kein doppelter Queryspeicher; Dispose gibt Ressourcen frei.

### AT-003 — Leeren Arbeitsbereich dauerhaft anlegen
**Requirements:** REQ-011, REQ-017, REQ-061 · **Phase:** P1 · **Ebene:** E2E

**Gegeben:** Leeres Browserprofil mit verfügbarer Persistenz.
**Wenn:** Projekt Beispielanalyse anlegen, Beschreibung ändern, Flush und Reload.
**Dann:** Gleiche Workspace-ID, Namen/Beschreibung/Zeitstempel bleiben; keine Demo-Projekte, keine gestartete R-Runtime allein durch die Projektliste.

### AT-004 — Namen und Referenzintegrität
**Requirements:** REQ-012, REQ-014 · **Phase:** P1 · **Ebene:** Unit

**Gegeben:** Gültige Workspace-Fixture.
**Wenn:** Leere Namen, fremde Workspace-IDs, falsch zugeordnete Versions-/Ergebnis-IDs, Schlüssel-ID-Mismatch und reservierte Aliase einsetzen.
**Dann:** Strukturierte Validierungsfehler mit Feldpfad; kein Commit. Gültige Unicode-Anzeigenamen erlaubt; SQL-Aliase innerhalb vorgegebener Regeln.

### AT-005 — Gespeicherte Analyse ist ein Projektobjekt
**Requirements:** REQ-011, REQ-034, REQ-035 · **Phase:** P1 · **Ebene:** Unit/E2E

**Gegeben:** Ein Projekt ohne Daten.
**Wenn:** SQL- und R-Analyse anlegen, bearbeiten, umbenennen, duplizieren und archivieren.
**Dann:** Unabhängige IDs/Code-/Undo-Zustände, richtige Sprache/Engine; archivierter Code verschwindet aus aktiver Liste, historische Laufherkunft bleibt.

### AT-006 — Revisionen und unveränderliche Snapshots
**Requirements:** REQ-011, REQ-013, REQ-036 · **Phase:** P1 · **Ebene:** Unit

**Gegeben:** Workspace mit DatasetVersion und abgeschlossener SQL-Ausführung.
**Wenn:** Anzeigenamen/Editor ändern und neue Datenversion erstellen.
**Dann:** Formatversion bleibt 1; Repositoryrevision, Analyserevision und Versions-ID bleiben unterschiedliche Werte; alter Snapshot/Resultatinhalt unverändert.

### AT-007 — Beschädigtes oder unbekanntes Projektformat
**Requirements:** REQ-016 · **Phase:** P1 · **Ebene:** Unit/Browser

**Gegeben:** Ein bestehender gültiger IndexedDB-Datensatz.
**Wenn:** Ungültige Referenz bzw. formatVersion 99 laden; separate Testmigration mit Fehler auslösen.
**Dann:** Kontrollierte Meldung, keine leere Neuinitialisierung/Überschreibung; fehlgeschlagene Migration atomar zurückgerollt.

### AT-008 — CSV mit Quotes, BOM, Zeilenumbrüchen und NULL
**Requirements:** REQ-024, REQ-025 · **Phase:** P2 · **Ebene:** Integration

**Gegeben:** fixtures/csv-edge-cases.csv, explizites bestätigtes Schema.
**Wenn:** Vorschau bestätigen, komplett importieren, Daten nach Reload abfragen.
**Dann:** Führende Nullen, Umlaute, Semikolon im Feld, eingebetteter Newline, Leerstring und NULL bleiben unterscheidbar; UTF-8-BOM wird nicht Spalteninhalt.

### AT-009 — Später CSV-Typfehler statt stiller NULL
**Requirements:** REQ-025, REQ-076 · **Phase:** P2 · **Ebene:** Integration

**Gegeben:** CSV mit gültiger 200-Zeilen-Vorschau und nicht numerischem Wert in Zeile 5000 einer INTEGER-Spalte.
**Wenn:** Vollständig importieren.
**Dann:** Import scheitert mit Spalten-/Zeileninformation; keine Zeile still übersprungen, kein partielles Dataset publiziert, vorherige Daten intakt.

### AT-010 — Parquet und persistente lokale Originaldaten
**Requirements:** REQ-017, REQ-024, REQ-026 · **Phase:** P2 · **Ebene:** Integration/E2E

**Gegeben:** Aus Fixtures mit Ziel-DuckDB erzeugte Parquetdatei.
**Wenn:** Importieren, ursprüngliche Nutzerdatei verschieben/entfernen, Browserkontext neu starten.
**Dann:** Schema und Werte aus appverwalteten Bytes verfügbar; keine erneute Pfadfreigabe erforderlich; Nutzerdatei wurde nicht geändert.

### AT-011 — Autosave-Race: ältere Speicherung
**Requirements:** REQ-019 · **Phase:** P1 · **Ebene:** Unit/Browser

**Gegeben:** Commit von Generation 4 ist künstlich verzögert.
**Wenn:** Währenddessen Generation 5 tippen; Commit 4 abschliessen, dann Flush.
**Dann:** Editor bleibt Generation 5; Status nach Commit 4 weiterhin dirty; final gespeicherte Generation 5, keine verlorene Änderung; Debounce/Maxwait nachweisbar.

### AT-012 — Zwei Tabs, exklusiver Writer und CAS
**Requirements:** REQ-020 · **Phase:** P6 · **Ebene:** Browser

**Gegeben:** Zwei Tabs derselben Origin öffnen dieselbe Workspace-ID.
**Wenn:** Tab A schreibt; B versucht Mutation. Anschliessend A schliessen und in B erneut Schreibrecht anfordern.
**Dann:** B zuerst sichtbar read-only ohne Laufstart; nach Lockfreigabe Dokument neu geladen. Simulierter Revisionkonflikt überschreibt nichts.

### AT-013 — OPFS voll während Import oder Keep
**Requirements:** REQ-018, REQ-022, REQ-076 · **Phase:** P2 · **Ebene:** Fault/Browser

**Gegeben:** Ein gültiger gespeicherter Workspace und injizierter QuotaExceededError.
**Wenn:** Neue Datei oder Resultat sichern.
**Dann:** Kein falscher Erfolgsstatus und keine neue dauerhafte Referenz; alter Projektstand verwendbar; Retry/Export und persistenter Fehlerhinweis.

### AT-014 — Absturz zwischen Datei und Metadaten
**Requirements:** REQ-018, REQ-021 · **Phase:** P2 · **Ebene:** Fault/Browser

**Gegeben:** Dateischreiben abgeschlossen, Metadatencommit absichtlich verhindert.
**Wenn:** Seite schliessen und wieder öffnen; Recovery/Bereinigung ausführen.
**Dann:** Vorheriger Projektstand bleibt gültig. Neue Datei als Orphan erkannt und erst unter passendem exklusivem Lock bereinigt.

### AT-015 — Neustart während eines Laufs
**Requirements:** REQ-021, REQ-037 · **Phase:** P6 · **Ebene:** Browser

**Gegeben:** Ein Run ist running bzw. cancelling im Dokument.
**Wenn:** Browserprozess/Tab beenden, Projekt neu öffnen.
**Dann:** Lauf wird interrupted; keine automatische Wiederholung; temporäres Ergebnis unavailable, gesicherte ältere Resultate weiter erreichbar.

### AT-016 — Fehlende Browserpersistenz
**Requirements:** REQ-022, REQ-073 · **Phase:** P2 · **Ebene:** Browser

**Gegeben:** Capability-Probe für OPFS oder IndexedDB schlägt fehl.
**Wenn:** App starten und einen Import versuchen.
**Dann:** Deutlicher Sitzungsmodus erst nach Zustimmung; keine Aussage lokal gespeichert; eigener temporärer Store, Export möglich innerhalb Budgets.

### AT-017 — Fehlendes Artefakt ohne Verlust des Codes
**Requirements:** REQ-021, REQ-044 · **Phase:** P6 · **Ebene:** Browser

**Gegeben:** Ein Keep-Resultat und gespeicherter SQL-Code.
**Wenn:** Artefaktdatei ausserhalb des regulären Ablaufs entfernen; neu öffnen.
**Dann:** Code/Metadaten lesbar, Ergebnis als fehlend bezeichnet, keine automatische Neuberechnung und kein scheinbar leeres erfolgreiches Resultat.

### AT-018 — SQL-Namen bei mehreren Imports
**Requirements:** REQ-014, REQ-024, REQ-027 · **Phase:** P2 · **Ebene:** Integration

**Gegeben:** Zwei Dateien mit gleichem Basisnamen und eine mit ungültigen Zeichen.
**Wenn:** Nacheinander importieren, Anzeigenamen später ändern.
**Dann:** Eindeutige bestätigte Aliase mit Suffix; keine Überschreibung. Anzeigenamenänderung bricht gespeichertes SQL nicht.

### AT-019 — Versionierter Datenersatz während Lauf
**Requirements:** REQ-013, REQ-027, REQ-036, REQ-038 · **Phase:** P2 · **Ebene:** Unit/Integration

**Gegeben:** Ein Datenstand v1 und eine laufende Abfrage.
**Wenn:** CSV v2 über Ersetzen bestätigen.
**Dann:** Scheduler verhindert Änderung des aktiven Snapshots; alter Lauf nutzt v1; nächster Lauf v2; Schema-Diff sichtbar und Versionhistorie korrekt.

### AT-020 — Grenzen und ungültige Importformate
**Requirements:** REQ-024, REQ-026, REQ-073 · **Phase:** P2 · **Ebene:** Integration

**Gegeben:** Header-only-CSV, Nullbyte-Datei, beschädigtes Parquet, XLSX und Datei über Defaultlimit.
**Wenn:** Jeweils importieren.
**Dann:** Gültige 0-Zeilen-Tabelle zulässig; defekte/leere Inhalte/unsupported Formate/Grössenüberschreitung klar abgewiesen; keine stillen Formatkonversionen.

### AT-021 — Golden-SQL über drei Datensätze
**Requirements:** REQ-025, REQ-039, REQ-041 · **Phase:** P3 · **Ebene:** Echte DuckDB-WASM

**Gegeben:** Fixtures Gemeinden, Bevölkerung und Fahrzeuge unter ihren vereinbarten Aliasen.
**Wenn:** fixtures/01-fahrzeuge-pro-1000.sql mit jahr=2024 ausführen.
**Dann:** Genau vier Zeilen wie golden/sql-2024.json, Sortierung und NULL bei Bevölkerung 0 korrekt; Identifikatoren bleiben dreistellig.

### AT-022 — SELECT ohne Daten
**Requirements:** REQ-011, REQ-034, REQ-040 · **Phase:** P3 · **Ebene:** Echte DuckDB-WASM

**Gegeben:** Leerer Workspace, gespeicherte neue SQL-Analyse.
**Wenn:** SELECT 1 AS wert ausführen.
**Dann:** Ein erfolgreiches TableResult; kein erzwungener Dataset-Import und keine erfundene Eingabereferenz.

### AT-023 — SQL-Guard mit Syntaxfällen
**Requirements:** REQ-040, REQ-071 · **Phase:** P3 · **Ebene:** Parser/Integration

**Gegeben:** Korpus erlaubter SELECT/WITH/Windowqueries und verbotener Statements/Funktionen.
**Wenn:** Kommentare, Semikolon in String, CTE, UNION; dazu mehrere Statements, COPY/ATTACH/INSTALL, externer Reader und dynamische SQL-Funktion prüfen.
**Dann:** Erlaubte Querytypen funktionieren; verbotene Fälle vor Ausführung abgelehnt. Kein startsWith-Guard, keine regexbedingte Fehlinterpretation von Strings.

### AT-024 — Workspace-Isolation
**Requirements:** REQ-009, REQ-012, REQ-039, REQ-059 · **Phase:** P2 · **Ebene:** Browser

**Gegeben:** A besitzt Tabelle geheim_in_a; B ist leer.
**Wenn:** Zwischen A und B wechseln; verspätete Antwort von A auslösen und in B nach Tabelle fragen.
**Dann:** B enthält weder Tabelle noch Resultat von A; alte Antwort verworfen/freigegeben; keine zweite nebenläufige A-Session bleibt.

### AT-025 — Gebundene Parameter statt Stringersetzung
**Requirements:** REQ-035, REQ-040 · **Phase:** P3 · **Ebene:** Echte DuckDB-WASM

**Gegeben:** Textparameter enthält Quote/Semikolon, Zahlparameter jahr=2024 und exakter int64-Text.
**Wenn:** Mit Prepared Binding ausführen, R-params entsprechend binden.
**Dann:** Werte bleiben Werte; keine zweite Anweisung, int64 nicht in unsichere JS-Number umgewandelt. Fehlende/ungültige Parameter erhalten klare Fehler.

### AT-026 — Editor ändern während Ausführung
**Requirements:** REQ-034, REQ-036, REQ-037 · **Phase:** P3 · **Ebene:** Browser

**Gegeben:** Langsam beantwortete Abfrage A ist gestartet.
**Wenn:** Editor auf Code B ändern, danach A fertigstellen.
**Dann:** Run enthält Snapshot A, Editor B, Resultat eindeutig A zugeordnet; B wird weder ausgeführt noch überschrieben.

### AT-027 — Stabile Ergebnisse trotz Paging/Sortierung
**Requirements:** REQ-041, REQ-046 · **Phase:** P3 · **Ebene:** Echte DuckDB-WASM

**Gegeben:** SELECT i, random() AS r FROM range(350) AS t(i) als einzelner Lauf.
**Wenn:** Seiten vor/zurück, Sortierung und Chart wechseln, danach exportieren.
**Dann:** 350 identische pro Zeile zugeordnete Randomwerte; ursprüngliches SQL nur einmal gestartet; Paging ohne verlorene/doppelte Zeilen.

### AT-028 — App-Limit ist nicht tatsächliche Gesamtzahl
**Requirements:** REQ-042 · **Phase:** P3 · **Ebene:** Echte DuckDB-WASM

**Gegeben:** Testlimit 1000 Zeilen, Query über range(1500).
**Wenn:** Ausführen; zusätzlich Query mit eigenem LIMIT 10 prüfen.
**Dann:** App-Limit: 1000 Zeilen mit coverage limited, keine erfundene 1500-Gesamtzahl/zweite COUNT-Abfrage. Eigenes LIMIT 10: vollständig bezüglich SQL.

### AT-029 — Breite Daten und Bytebudget
**Requirements:** REQ-042, REQ-055 · **Phase:** P3 · **Ebene:** Integration

**Gegeben:** Wenige Zeilen mit sehr grossen Textwerten überschreiten Bytebudget.
**Wenn:** Query ausführen.
**Dann:** Kontrollierter Limitfehler statt unbeschränkter Kopien; kein unvollständig veröffentlichtes TableResult, neue Handles freigegeben.

### AT-030 — SQL-Abbruch beendet echte Berechnung
**Requirements:** REQ-037, REQ-038, REQ-043 · **Phase:** P3 · **Ebene:** Echte DuckDB-WASM

**Gegeben:** Nachweislich lange Query und aktiver Scheduler.
**Wenn:** Abbrechen, danach eine kleine Query ausführen.
**Dann:** Alte Query ist settled/Runtime beendet; danach kleiner Lauf möglich. Nicht nur UI-Promise cancelled; Cancel trifft keinen fremden Lauf.

### AT-031 — Timeout und Reset-Epoch
**Requirements:** REQ-037, REQ-043, REQ-059 · **Phase:** P3 · **Ebene:** Echte DuckDB-WASM/Fault

**Gegeben:** Timeouttest mit absichtlich kurzem Budget und simulierter nicht antwortender Cancel-API.
**Wenn:** Timeout überschreiten, Grace ablaufen lassen.
**Dann:** Worker beendet, Epoch steigt, alte Handles ungültig; keine späte Erfolgsmeldung; erneute Initialisierung möglich.

### AT-032 — Aufbewahren und vollständiger Ergebnisexport
**Requirements:** REQ-044, REQ-045, REQ-048 · **Phase:** P3 · **Ebene:** E2E

**Gegeben:** 350-Zeilen-Resultat, aktuell nur erste Gridseite sichtbar.
**Wenn:** Aufbewahren, CSV/Parquet exportieren, Reload.
**Dann:** 350 Zeilen in Datei und nach Reopen; interne Ordinalspalte nicht exportiert; temporäres anderes Resultat nach Reload nicht fälschlich vorhanden.

### AT-033 — Portal-Dataset-Kontext v4
**Requirements:** REQ-029, REQ-030 · **Phase:** P4 · **Ebene:** HTTP/Browser

**Gegeben:** Fixture-Portal liefert echten v4-DTO-Aufbau mit 2 Tabellen und absichtlich fremden Runtime-/Paketpfaden.
**Wenn:** Einzel-Dataset über ID auflösen.
**Dann:** Titel/Schema/Lizenz/Tabellen übernommen, Nutzer wählt Tabellen. Fremde Runtimekonfiguration ignoriert; kein automatisches ATTACH von catalog.duckdb.

### AT-034 — Current-Ausgabe auf konkrete ID binden
**Requirements:** REQ-029, REQ-036 · **Phase:** P4 · **Ebene:** HTTP/Browser

**Gegeben:** /issues/current liefert issue-2024; später liefert dieselbe URL issue-2025.
**Wenn:** 2024 hinzufügen und speichern, später bestehenden Stand auflösen.
**Dann:** Gespeicherte target.issueId bleibt issue-2024; canonicalUrl=current wird nicht als Versionsidentität benutzt. Neuer Stand nur ausdrücklich als neue Version.

### AT-035 — Relative URLs und Provider-Origin
**Requirements:** REQ-029, REQ-033 · **Phase:** P4 · **Ebene:** HTTP/Browser

**Gegeben:** Werkstatt auf Port 4173, Fixture-Portal auf 4174; relative Parquet-URL im Context.
**Wenn:** Ressource auflösen und Query starten.
**Dann:** Abruf erfolgt von Portalbasis 4174, nicht Werkstatt; keine Cookies. Unerlaubtes Origin, URL-Userinfo und gefährliches Schema werden abgelehnt.

### AT-036 — CORS-, 404- und leere Portalantworten
**Requirements:** REQ-029, REQ-032, REQ-033, REQ-076 · **Phase:** P4 · **Ebene:** HTTP/Browser

**Gegeben:** Bestehendes Projekt; Testserver mit fehlendem CORS, 404, falschem MIME oder leerer Tabellenliste.
**Wenn:** Neue Portalquelle hinzufügen.
**Dann:** Konkreter Fehler ohne Projektmutation; kein no-cors-Trick und kein Dummy-Datensatz; Retry nur bei sinnvoll behebbaren Fehlern.

### AT-037 — Externe Version und lokaler Snapshot
**Requirements:** REQ-013, REQ-028, REQ-033, REQ-057 · **Phase:** P4 · **Ebene:** HTTP/Integration

**Gegeben:** Parquetreferenz ohne geprüften Hash, Testserver wechselt ETag/Schemastand.
**Wenn:** Referenz verwenden, lokal sichern und später Serverdaten ändern.
**Dann:** Ungesicherte Referenz nicht als eingefroren dargestellt; erkannte Änderung SOURCE_CHANGED. Lokaler gesicherter Stand bleibt mit Hash unabhängig erhalten.

### AT-038 — Deep Link ist idempotenter Einstieg
**Requirements:** REQ-032, REQ-060, REQ-071 · **Phase:** P4 · **Ebene:** E2E

**Gegeben:** /open mit gültigem Provider/Dataset/Table.
**Wenn:** Vorschau bestätigen; Zielseite reloaden und Back/Forward verwenden.
**Dann:** Ein Import/Workspace statt Duplikaten; History ersetzt. Keine SQL-/R-Ausführung allein durch Öffnen.

### AT-039 — Optionaler Suchindex
**Requirements:** REQ-031 · **Phase:** P4 · **Ebene:** HTTP/E2E

**Gegeben:** Provider einmal mit, einmal ohne CatalogIndex.
**Wenn:** Indexsuche bzw. direkte Portal-URL-/ID-Eingabe verwenden.
**Dann:** Indexfilterung korrekt; ohne Index echter URL-/ID-Pfad weiterhin nutzbar, keine erfundene Katalogsuch-API und kein HTML-Scraping.

### AT-040 — R lazy und unabhängig vom Panel
**Requirements:** REQ-049, REQ-058, REQ-059 · **Phase:** P5 · **Ebene:** Echte webR

**Gegeben:** Workspace geöffnet, R noch unbenutzt.
**Wenn:** SQL-Seite, dann R öffnen; zwischen beiden mehrfach wechseln.
**Dann:** R genau einmal lazy gestartet, Objektzustand bleibt beim Seitenwechsel, Workspacewechsel beendet die Runtime.

### AT-041 — Golden-R-Skript
**Requirements:** REQ-050, REQ-051, REQ-057 · **Phase:** P5 · **Ebene:** Echte webR

**Gegeben:** Golden-SQL-Ergebnis als daten in R gebunden.
**Wenn:** fixtures/02-vergleich.R ausführen.
**Dann:** vergleich entspricht golden/r-vergleich.json, Klassifikation hoch/niedrig/nicht berechenbar korrekt; Konsole/Ergebnis diesem Lauf zugeordnet.

### AT-042 — Transfer nicht auf Gridseite begrenzt
**Requirements:** REQ-045, REQ-052, REQ-055 · **Phase:** P5 · **Ebene:** Echte DuckDB-WASM + webR

**Gegeben:** 350-Zeilen-SQL-Ergebnis bei 100 sichtbaren Gridzeilen.
**Wenn:** In gespeicherte R-Analyse übernehmen und nrow(daten) prüfen.
**Dann:** 350 Zeilen, Reihenfolge/Schema erhalten, Resultat vor dauerhafter Bindung gesichert; kein Auto-Run des R-Skripts.

### AT-043 — Integer-/Decimal-/Identifier-Grenzen
**Requirements:** REQ-054 · **Phase:** P5 · **Ebene:** Codec + echte Engines

**Gegeben:** fixtures/04-typgrenzen.sql sowie erwartete Typregeln.
**Wenn:** SQL→R→SQL-Rundlauf und geänderten ungültigen DECIMAL-Text versuchen.
**Dann:** −2147483648 bleibt Zahl statt NA; 2^53+1 bleibt exakt als Text; Identifier 001 bleibt 001; DECIMAL nicht still gerundet. Ungültiger Rückcast abgelehnt.

### AT-044 — NULL/NA ist nicht NaN/Infinity/Leerstring
**Requirements:** REQ-054 · **Phase:** P5 · **Ebene:** Codec + echte Engines

**Gegeben:** Spalten mit NULL, NaN, ±Inf, leerem und literalem NULL-String.
**Wenn:** Beide Transferrichtungen durchlaufen, Masken prüfen.
**Dann:** Alle semantisch unterscheidbaren Werte bleiben unterscheidbar; JSON-null-Abkürzung für nichtendliche Zahlen verboten.

### AT-045 — Datum, Zeitzone, Faktoren und Unsupported-Typen
**Requirements:** REQ-054, REQ-057 · **Phase:** P5 · **Ebene:** Codec + echte Engines

**Gegeben:** Datum um Zeitumstellung, Mikro-/Nanosekundenzeit, factor mit unbenutztem Level, BLOB/Struct.
**Wenn:** Transfer in beiden Richtungen und bei fehlender Precision kontrollieren.
**Dann:** Date taggenau, UTC explizit, nicht exakt abbildbare Timestamps als Text/Warnung; Faktorlevels erhalten; BLOB/Struct gezielt abgelehnt, nicht verstümmelt.

### AT-046 — PostMessage-R-Abbruch und Reset
**Requirements:** REQ-049, REQ-056 · **Phase:** P0/P5 · **Ebene:** Echte webR

**Gegeben:** PostMessage-Kanal und lang laufendes R-Skript.
**Wenn:** Abbrechen oder kurzes Timeout auslösen.
**Dann:** R-Worker tatsächlich beendet, alte Scopes/Epochrefs ungültig, Verlusthinweis sichtbar. Bei auto/SAB regulärer Interrupt als separater Test belegt.

### AT-047 — Fresh-Environment und stale Scopes
**Requirements:** REQ-050, REQ-057 · **Phase:** P5 · **Ebene:** Echte webR

**Gegeben:** Sitzungsobjekt x, mehrere fresh-environment-Läufe.
**Wenn:** Variablen pro Scope verändern; alten RObjectRef nach Reset benutzen.
**Dann:** Scopedaten eindeutig; alter Ref abgewiesen. Fresh-Modus behauptet keine Prozessisolation; Scope-Aufräumen zerstört kein aktiv ausgewähltes Objekt.

### AT-048 — R-Objekt explizit zurück nach SQL
**Requirements:** REQ-051, REQ-053, REQ-057 · **Phase:** P5 · **Ebene:** Echte Engines

**Gegeben:** vergleich im aktiven RScope, danach bewusst geänderter Wert.
**Wenn:** Aktuellen Dataframe übernehmen und fixtures/03-klassifikation.sql ausführen.
**Dann:** Neuer Capture-Lauf/Resultat/DatasetVersion beschreibt tatsächlichen Objektstand; Rück-SQL korrekt. Kein Wiederholen des ursprünglichen Skripts und keine heimliche Überschreibung.

### AT-049 — Diagrammsemantik und Grenzen
**Requirements:** REQ-047, REQ-048 · **Phase:** P3 · **Ebene:** Integration/UI

**Gegeben:** TableResult mit NULL-Werten, sortierter Reihe und einmal >5000 Punkten.
**Wenn:** Bar/Line/Scatter wählen, speichern und PNG exportieren.
**Dann:** Werte/Sortierung korrekt, NULL nicht 0, Quelle aufbewahrt. Bei zu vielen Punkten Aufforderung zur Aggregation, kein stilles Sampling.

### AT-050 — Sicherung einer referenzierten temporären Tabelle
**Requirements:** REQ-018, REQ-044, REQ-045 · **Phase:** P6 · **Ebene:** Fault/Integration

**Gegeben:** Ein ungesichertes Resultat wird als gespeicherter R-Input oder Chartquelle gewählt.
**Wenn:** Sicherung einmal erfolgreich, einmal mit Quota-/Commitfehler ausführen.
**Dann:** Nur erfolgreicher Pfad publiziert dauerhafte Referenz. Fehler lässt Input/Visualization unverändert; keine Bindung auf verlorene temporäre Bytes.

### AT-051 — Archiv mit Daten in frischem Profil
**Requirements:** REQ-068, REQ-069 · **Phase:** P6 · **Ebene:** E2E

**Gegeben:** Workspace mit lokalen Daten, SQL/R, Runs, kept Resultat und Diagramm.
**Wenn:** With-data exportieren und in frischem Profil importieren.
**Dann:** Neue IDs/gleiche technische Aliase; alle Referenzen remapped, echte Daten/Plots vorhanden; Code unverändert und nie automatisch ausgeführt.

### AT-052 — Transferabbruch vor Publikation
**Requirements:** REQ-038, REQ-053, REQ-055, REQ-059 · **Phase:** P5/P6 · **Ebene:** Fault/Browser

**Gegeben:** Transferplan besteht; Quelle/Scope wird invalidiert oder Write unterbrochen.
**Wenn:** CommitToR/CommitFromR fortsetzen.
**Dann:** Plan abgewiesen oder sauber abgebrochen, keine halbe Dateneinbindung/Variable als bestätigt; keine späte Mutation eines anderen Workspaces.

### AT-053 — Referenzgraph schützt Herkunft
**Requirements:** REQ-015, REQ-021, REQ-045 · **Phase:** P6 · **Ebene:** Unit/Browser

**Gegeben:** Aufbewahrtes Resultat, davon abgeleitetes Dataset und archivierte ursprüngliche Analyse.
**Wenn:** Historie/Cache bereinigen und ursprüngliche Dateneinbindung entfernen.
**Dann:** Benötigte Versionen/Artefakte/Run-Snapshot bleiben; Entfernen wirkt auf neue Nutzung, nicht auf historische Herkunft. Keine fremden OPFS-Dateien gelöscht.

### AT-054 — Platzvertrag SQL und R
**Requirements:** REQ-065, REQ-066 · **Phase:** P7 · **Ebene:** UI-Geometrie

**Gegeben:** Viewport 1440×900 sowie 1280×800, Schema-/Info-Drawer geschlossen.
**Wenn:** Screens rendern, relevante bounding boxes messen.
**Dann:** Arbeitsflächenhöhen/-breiten erfüllen REQ-066; kein Hero/Eyebrow/Info-Dauerpanel; collapsed Sidebar initial auf SQL/R; keine Überlappungen.

### AT-055 — Tastatur, Fokus und Splitter
**Requirements:** REQ-062, REQ-063, REQ-067 · **Phase:** P3/P7 · **Ebene:** E2E/A11y

**Gegeben:** Workspace mit SQL/R und geöffnetem Dialog.
**Wenn:** Tastaturnavigation, Escape, Ctrl/Cmd+S/Enter, Pfeiltasten am Splitter.
**Dann:** Fokus sichtbar/korrekt zurückgesetzt; Save/Run wie beschrieben; keine Browser-Speicherseite; Screenreader-Namen für Iconbuttons vorhanden.

### AT-056 — Bösartige URL-/Metadateninhalte sind kein Code
**Requirements:** REQ-005, REQ-030, REQ-032, REQ-033, REQ-071, REQ-072 · **Phase:** P4 · **Ebene:** Security/Browser

**Gegeben:** Katalogtitel, Zellen und Archivcode enthalten harmlose Scriptmarker; Deep-Link enthält sql=/r=-Parameter.
**Wenn:** Daten laden/anzeigen und Projekt öffnen.
**Dann:** Kein Scriptmarker ausgeführt, kein Auto-Run, keine fremden Runtimepfade übernommen. Vorgesehene R-Ausführung nur auf ausdrücklichen Run-Klick.

### AT-057 — V1-Umfang und kleine Einstellungen
**Requirements:** REQ-003, REQ-004, REQ-061, REQ-064, REQ-065 · **Phase:** P1/P7 · **Ebene:** UI/Review

**Gegeben:** Produktionsprofil ohne Testseeds.
**Wenn:** Navigation, leere Zustände, Einstellungen und Originalbranding prüfen.
**Dann:** Kein Loginavatar/Freigaben/KI/ClickHouse-Menü, keine doppelten Workspace-Listen; nur implementierte Settings; echtes Logo oder expliziter Releaseblocker.

### AT-058 — Routen, Modelle und Viewzustand
**Requirements:** REQ-019, REQ-034, REQ-058, REQ-059, REQ-060 · **Phase:** P3/P7 · **Ebene:** Browser

**Gegeben:** Mehrere Analysen eines Workspaces.
**Wenn:** Back/Forward, Analyse-/SQL-R-Wechsel, Layout ändern und Reload.
**Dann:** Richtige Analyse-/Workspace-Zugehörigkeit; Undo/Cursor bleiben beim Wechsel; Layoutsave ist keine fachliche Revision. Ungültige Routen kontrolliert.

### AT-059 — Recipe-Archiv mit fehlenden Daten
**Requirements:** REQ-016, REQ-068, REQ-069 · **Phase:** P6 · **Ebene:** E2E

**Gegeben:** fixtures/sample.dwproj ohne Bytes.
**Wenn:** Importieren und enthaltene Analysen öffnen.
**Dann:** Daten als fehlend markiert, Code bearbeitbar, keine stillen leeren Tabellen; IDs remapped und keine dangling Artefaktreferenzen.

### AT-060 — Archivpfade, Zip-Bomb und Duplikate
**Requirements:** REQ-070, REQ-071 · **Phase:** P6 · **Ebene:** Security/Integration

**Gegeben:** Erzeugte kleine Archive mit Traversal, absolutem Pfad, doppeltem normalisiertem Eintrag, Symlink, exzessiver Expansion.
**Wenn:** Archivinspektion/import aufrufen.
**Dann:** Alle unzulässigen Fälle vor Veröffentlichung abgelehnt; Streaminglimits tatsächlich durchgesetzt; keine Dateien ausserhalb des eigenen staging-Bereichs geschrieben.

### AT-061 — Hashfehler eines Artefakts
**Requirements:** REQ-018, REQ-021, REQ-070 · **Phase:** P6 · **Ebene:** Fault/Integration

**Gegeben:** Artefakt mit korrektem Manifesthash, danach ein Byte verändert.
**Wenn:** Archiv importieren bzw. aufbewahrtes Resultat nach Reopen erstmalig nutzen.
**Dann:** ARTIFACT_CORRUPT/ARCHIVE_INVALID; keine unzutreffend geprüfte/verwendete Tabelle; andere Projektinhalte lesbar.

### AT-062 — R-Transfergrenzen und Typfreigabe
**Requirements:** REQ-052, REQ-054, REQ-055 · **Phase:** P5 · **Ebene:** Integration

**Gegeben:** Resultate knapp unter/über Warn-/Hardgrenze und mit Repräsentationswarnung.
**Wenn:** Plan und Commit durchführen, auch nach Sourceänderung.
**Dann:** Warnung erfordert Bestätigung; Hardlimit blockiert ohne Sampling; Plan ist versionsgebunden. Keine genehmigungslose stille Konversion.

### AT-063 — Duplizieren und Workspace löschen
**Requirements:** REQ-015, REQ-023, REQ-069 · **Phase:** P6 · **Ebene:** E2E

**Gegeben:** Zwei unabhängige Workspaces, einer mit kept Resultaten/History.
**Wenn:** Ersten duplizieren und Original nach Bestätigung löschen.
**Dann:** Duplikat hat neue IDs/Dateien, bleibt funktionsfähig; zweiter Workspace unverändert. Keine globalen DB-Löschbefehle oder gemeinsame Artefaktlöschung.

### AT-064 — Archivimport scheitert atomar
**Requirements:** REQ-018, REQ-069, REQ-070 · **Phase:** P6 · **Ebene:** Fault/Browser

**Gegeben:** Gültiges Archiv; Fehler nach Dateiextraktion vor Metadata-Commit injiziert.
**Wenn:** Importieren, danach Recovery ausführen.
**Dann:** Kein halbes neues Projekt in Liste; bestehende Projekte unverändert; Stagingreste eindeutig und unter Lock bereinigbar.

### AT-065 — Web Locks nicht verfügbar
**Requirements:** REQ-020, REQ-022 · **Phase:** P6 · **Ebene:** Browser

**Gegeben:** Web Locks im Capabilitytest deaktiviert, bestehender persistenter Workspace.
**Wenn:** Öffnen und bearbeiten/ausführen versuchen.
**Dann:** Bestehendes Projekt lesend; kein unsicherer Writer-Fallback. Expliziter neuer Sitzungsmodus möglich, aber ohne falsche Dauerhaftigkeit.

### AT-066 — Container mit OpenShift-artiger UID
**Requirements:** REQ-074 · **Phase:** P7 · **Ebene:** Container

**Gegeben:** Gebautes Image ohne privilegierte Laufzeit.
**Wenn:** Mit beliebiger nicht-root UID starten, Port 8080 prüfen, statische App abrufen.
**Dann:** App ohne unerwartete Dateisystemrechte lauffähig; keine Runtimeinstallation von Nodepaketen oder versteckten Secrets.

### AT-067 — Base-Path, MIME und echter 404
**Requirements:** REQ-060, REQ-073, REQ-074 · **Phase:** P7 · **Ebene:** HTTP/E2E

**Gegeben:** Build unter / und unter /lab/.
**Wenn:** Tiefe Workspace-Route reloaden; nicht existierendes JS/WASM und runtime-config.json abfragen.
**Dann:** SPA-Routen funktionieren, fehlende Assets liefern 404 statt index.html; richtige MIME- und Cache-Regeln; ungültige Config nicht permissiv umgangen.

### AT-068 — CSP, Netzverkehr und Kommunikationsprofile
**Requirements:** REQ-005, REQ-033, REQ-071, REQ-072, REQ-075 · **Phase:** P7 · **Ebene:** HTTP/Browser

**Gegeben:** PostMessage- und optional isoliertes auto-Deploymentprofil.
**Wenn:** Alle Kernabläufe samt Netzwerkaufzeichnung ausführen.
**Dann:** Nur konfigurierte öffentliche Daten und lokale Runtimeassets geladen; keine Telemetrie/externe Fonts/Modelle. Worker/WASM funktionieren mit dokumentierter CSP; kein unerklärter Service Worker.

### AT-069 — Fehlendes Runtimeasset oder Paket
**Requirements:** REQ-049, REQ-073, REQ-074, REQ-075, REQ-076 · **Phase:** P7 · **Ebene:** HTTP/Browser

**Gegeben:** Testserver liefert R-Paket oder WASM mit 404/falschem MIME.
**Wenn:** R/SQL initialisieren, danach Asset korrigieren und Retry.
**Dann:** Konkrete Init-Meldung, keine Endlosschleife/Fakeresultate. Retry erzeugt genau eine gültige Runtime, Fehlerressourcen freigegeben.

### AT-070 — Clean-Checkout-Verifikation und Browsermatrix
**Requirements:** REQ-007, REQ-077, REQ-078, REQ-079, REQ-080 · **Phase:** P8 · **Ebene:** CI

**Gegeben:** Frischer Checkout des freizugebenden Builds.
**Wenn:** Dokumentierte npm-/Browser-/Buildbefehle aufrufen.
**Dann:** Verify beendet korrekt; echte Engine-Tests nicht geskippt; Browser-/Runtimeversionen/Exitcodes erfasst. Nicht ausgeführter Safari-Pilot nicht als bestanden deklariert.

### AT-071 — Ressourcenzyklen und Pilotbudgets
**Requirements:** REQ-038, REQ-055, REQ-056, REQ-059, REQ-073, REQ-076, REQ-078, REQ-080 · **Phase:** P8 · **Ebene:** Benchmark/Browser

**Gegeben:** Kleine Goldenfixtures und erzeugte 10k/100k-Datensätze.
**Wenn:** 20 Workspace-/R-Reset-/SQL-Zyklen, Timing/Worker-/Handlecounts messen.
**Dann:** Kein linear wachsender Worker-/Handlebestand; Budgetabbrüche bedienbar; gemessene Zeiten/Umgebung dokumentiert, keine erfundenen Peak-RAM-Zusagen.

### AT-072 — Vollständiger Golden Path nach Neustart
**Requirements:** REQ-001, REQ-003, REQ-017, REQ-029, REQ-041, REQ-045, REQ-048, REQ-052, REQ-053, REQ-068, REQ-069, REQ-077, REQ-078, REQ-079, REQ-080 · **Phase:** P8 · **Ebene:** Echte Engines/E2E

**Gegeben:** Frisches Profil; Bevölkerung aus Fixture-Portal, Fahrzeuge/Gemeinden als lokale CSV.
**Wenn:** Projekt anlegen, Golden-SQL speichern/ausführen, nach R, Golden-R ausführen, vergleich als Dataset übernehmen, Rück-SQL ausführen, Ergebnisse sichern, exportieren, Browser neu starten, Projekt prüfen.
**Dann:** SQL: 4 Zeilen; R: hoch=2, niedrig=1, nicht berechenbar=1; Rück-SQL exakt golden/rueck-sql.json. Code, konkrete Herkunft und kept Daten bleiben; kein Auto-Run. Importiertes Archiv im zweiten frischen Profil ebenso nachvollziehbar.

## Traceability: Requirement → Abnahme

| Requirement | Tests |
|---|---|
| REQ-001 | AT-001, AT-072 |
| REQ-002 | AT-001 |
| REQ-003 | AT-057, AT-072 |
| REQ-004 | AT-057 |
| REQ-005 | AT-056, AT-068 |
| REQ-006 | AT-001 |
| REQ-007 | AT-001, AT-070 |
| REQ-008 | AT-002 |
| REQ-009 | AT-002, AT-024 |
| REQ-010 | AT-002 |
| REQ-011 | AT-003, AT-005, AT-006, AT-022 |
| REQ-012 | AT-004, AT-024 |
| REQ-013 | AT-006, AT-019, AT-037 |
| REQ-014 | AT-004, AT-018 |
| REQ-015 | AT-053, AT-063 |
| REQ-016 | AT-007, AT-059 |
| REQ-017 | AT-003, AT-010, AT-072 |
| REQ-018 | AT-013, AT-014, AT-050, AT-061, AT-064 |
| REQ-019 | AT-011, AT-058 |
| REQ-020 | AT-012, AT-065 |
| REQ-021 | AT-014, AT-015, AT-017, AT-053, AT-061 |
| REQ-022 | AT-013, AT-016, AT-065 |
| REQ-023 | AT-063 |
| REQ-024 | AT-008, AT-010, AT-018, AT-020 |
| REQ-025 | AT-008, AT-009, AT-021 |
| REQ-026 | AT-010, AT-020 |
| REQ-027 | AT-018, AT-019 |
| REQ-028 | AT-037 |
| REQ-029 | AT-033, AT-034, AT-035, AT-036, AT-072 |
| REQ-030 | AT-033, AT-056 |
| REQ-031 | AT-039 |
| REQ-032 | AT-036, AT-038, AT-056 |
| REQ-033 | AT-035, AT-036, AT-037, AT-056, AT-068 |
| REQ-034 | AT-005, AT-022, AT-026, AT-058 |
| REQ-035 | AT-005, AT-025 |
| REQ-036 | AT-006, AT-019, AT-026, AT-034 |
| REQ-037 | AT-015, AT-026, AT-030, AT-031 |
| REQ-038 | AT-019, AT-030, AT-052, AT-071 |
| REQ-039 | AT-021, AT-024 |
| REQ-040 | AT-022, AT-023, AT-025 |
| REQ-041 | AT-021, AT-027, AT-072 |
| REQ-042 | AT-028, AT-029 |
| REQ-043 | AT-030, AT-031 |
| REQ-044 | AT-017, AT-032, AT-050 |
| REQ-045 | AT-032, AT-042, AT-050, AT-053, AT-072 |
| REQ-046 | AT-027 |
| REQ-047 | AT-049 |
| REQ-048 | AT-032, AT-049, AT-072 |
| REQ-049 | AT-040, AT-046, AT-069 |
| REQ-050 | AT-041, AT-047 |
| REQ-051 | AT-041, AT-048 |
| REQ-052 | AT-042, AT-062, AT-072 |
| REQ-053 | AT-048, AT-052, AT-072 |
| REQ-054 | AT-043, AT-044, AT-045, AT-062 |
| REQ-055 | AT-029, AT-042, AT-052, AT-062, AT-071 |
| REQ-056 | AT-046, AT-071 |
| REQ-057 | AT-037, AT-041, AT-045, AT-047, AT-048 |
| REQ-058 | AT-002, AT-040, AT-058 |
| REQ-059 | AT-002, AT-024, AT-031, AT-040, AT-052, AT-058, AT-071 |
| REQ-060 | AT-038, AT-058, AT-067 |
| REQ-061 | AT-003, AT-057 |
| REQ-062 | AT-055 |
| REQ-063 | AT-055 |
| REQ-064 | AT-057 |
| REQ-065 | AT-054, AT-057 |
| REQ-066 | AT-054 |
| REQ-067 | AT-055 |
| REQ-068 | AT-051, AT-059, AT-072 |
| REQ-069 | AT-051, AT-059, AT-063, AT-064, AT-072 |
| REQ-070 | AT-060, AT-061, AT-064 |
| REQ-071 | AT-023, AT-038, AT-056, AT-060, AT-068 |
| REQ-072 | AT-056, AT-068 |
| REQ-073 | AT-016, AT-020, AT-067, AT-069, AT-071 |
| REQ-074 | AT-066, AT-067, AT-069 |
| REQ-075 | AT-068, AT-069 |
| REQ-076 | AT-009, AT-013, AT-036, AT-069, AT-071 |
| REQ-077 | AT-070, AT-072 |
| REQ-078 | AT-070, AT-071, AT-072 |
| REQ-079 | AT-070, AT-072 |
| REQ-080 | AT-070, AT-071, AT-072 |

## Abnahmereport

Der Agent ergänzt im Zielrepository je Test: Status, Datum, Git-SHA, Browser-/Engineversion, Befehl/Exitcode und Artefaktpfad. „Nicht verfügbar“, „manuell noch offen“ und „übersprungen“ sind keine bestandenen Tests. Ein Reviewfall kann als manuell bestanden dokumentiert werden, nicht als automatisch getestet.

Abschlussblocker: Verlust gespeicherter Daten, falsche Werte/Typen, Phantom-Erfolge, ungestoppte Worker, automatisches Ausführen fremden Codes, nicht integrierte Portalfunktion oder ein fehlender Golden Path in zugesicherten Browsern.
