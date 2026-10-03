# Direkt verwendbarer Auftrag

Kopiere diesen Text in die erste Nachricht an den Coding-Agenten, nachdem die Dateien dieses Pakets im autorisierten Zielrepository liegen:

---

Implementiere die Datenwerkstatt V1 anhand von `AGENTS.md`, `SPEC.md`, `contracts/`, `ACCEPTANCE_TESTS.md` und `IMPLEMENTATION_PLAN.md` in diesem Repository.

Es handelt sich um eine eigenständige React-/TypeScript-/Vite-SPA mit selektiven SQLRooms-Bausteinen, DuckDB-WASM, webR, IndexedDB und OPFS. Ausgangscode ist das Explore-Frontend aus `sogis/datenportal-sodata`; der geprüfte Commit und konkrete Dateien stehen in `docs/SOURCES.md`. Verändere das Quellportal nicht und lege keine neuen Remote-Repositories an.

Prüfe zuerst den bestehenden Arbeitsbaum und die installierbare Toolchain. Beginne mit P0 und gehe danach in der festgelegten Reihenfolge weiter. Implementiere echte vertikale Funktionspfade, nicht nur Screens oder einen weiteren Architekturplan. Die technischen Spikes müssen insbesondere verfügbare APIs, echten Abbruch und Dateispeicherung prüfen. Übernimm keine Beispielmethoden als vermeintliche Drittanbieter-API.

Beachte besonders: eine Runtime pro Workspace; Analyse != Lauf != Ergebnis; vollständiger SQL–R-Transfer; sichere Resultatspeicherung vor dauerhafter Bindung; kein Code-Autostart beim Öffnen; keine parallel gepflegten Projektmodelle. Die Editor-/Ergebnisflächen müssen die Oberfläche dominieren. Login, Freigaben, KI und ClickHouse gehören nicht zu V1.

Nutze die synthetischen Fixtures und die Abnahmetests als verbindliche Sollwerte. Führe die jeweils relevanten Tests tatsächlich aus. Halte `docs/IMPLEMENTATION_STATUS.md` mit Requirement-IDs, Dateipfaden, Befehlen, Exitcodes und offenen Abhängigkeiten aktuell. Erfinde bei fehlenden produktiven Endpunkten keine Daten: das Testprofil bleibt klar als solches bezeichnet.

Liefere pro abgeschlossenem Abschnitt einen prüfbaren Diff und einen sachlichen Status. Bei begrenztem Kontext einen sauberen Checkpoint mit konkretem nächstem Schritt hinterlassen; keine halb implementierte Gesamtanwendung als fertig ausgeben. Für den Abschluss gelten der vollständige Golden Path, die Fehlerfalltests und `npm run verify`.

---

## Fortsetzungsauftrag

Setze die Umsetzung nach `docs/IMPLEMENTATION_STATUS.md` fort. Prüfe zuerst Arbeitsbaum und letzte Testergebnisse. Bearbeite die nächste noch offene Phase aus `IMPLEMENTATION_PLAN.md`, erhalte die bereits bestandenen Abnahmetests und dokumentiere echte neue Verifikation. Kein Neustart des Projekts und keine erneute Architektur-Neuerfindung.
