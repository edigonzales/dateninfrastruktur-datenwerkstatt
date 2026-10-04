# ADR-001 — Nachgewiesene Grenzen der gepinnten Engines

Status: P0-Spikeentscheidung, keine vollständige Produktabnahme. 3. Oktober 2026.

## DuckDB-MVP-Fehler und EH

Das MVP-Bundle von DuckDB-WASM 1.33.1-dev57.0 wirft beim Serialisieren ungültiger/nicht unterstützter Statements `_setThrew is not defined`. Das EH-Bundle desselben Pakets liefert kontrollierte Parserfehler. `createWorkspaceRoom` bietet daher beide originalen Bundlevarianten an; der Browser wählt das unterstützte EH-Bundle. Keine Versionsänderung. Der Guard nutzt `json_serialize_sql` mit sicher quotiertem SQL-Text; ein Prepared Parameter scheitert hier an der Constant-at-bind-Anforderung.

Nachweis: `tests/integration/p0.spec.ts`, Parserkorpus und Guardkorpus; Chromium/Firefox/WebKit bestanden. Ein Browser ohne EH-Unterstützung ist bislang nicht als funktionsfähig freigegeben.

## Tatsächlicher SQL-Abbruch

`SELECT sum(sin(i::DOUBLE)) FROM range(10000000000) t(i)` läuft beim Abbruch noch. `cancelSent()` allein beendet die Abfrage innerhalb der 2000-ms-Frist nicht verlässlich. `getDb().terminate()` beendet den Worker tatsächlich; ein neu erzeugter Connector beantwortet SELECT 7. `connector.destroy()` kann dagegen auf `connection.close()` hinter der laufenden Berechnung warten.

Entscheidung: Nach Ablauf der Grace-Periode den ganzen SQL-Worker beenden. Produktiv muss der Scheduler den äusseren Job kontrolliert abschliessen, Epoch erhöhen und alle alten Handles invalidieren. Ein zurückgelassenes Engine-Promise wird nicht als erledigter Job ausgegeben. Diese Produktintegration ist P3-Arbeit. Test beobachtet Worker-close, nicht nur Promise.race.

## webR-Grafik und PostMessage

webR 0.6.0 `Shelter.captureR` scheiterte nach einer ersten Grafik beim Zurücksetzen des alten Grafikgeräts. Nach `options(device = webr::canvas)` unmittelbar nach Init funktioniert Capture. Die angeforderte logische Grösse 400×300 ergibt 800×600 Bildpixel; Test prüft tatsächlich gezeichnete Pixel.

PostMessage hat keinen regulären R-Interrupt. `close()` beendet einen laufenden repeat-Loop und den Worker; eine neue Runtime liefert 1+2. Scopes/Proxies dürfen dabei nicht weiterverwendet werden. SharedArrayBuffer-Profil wurde nicht geprüft und wird nicht als bestanden bezeichnet.
