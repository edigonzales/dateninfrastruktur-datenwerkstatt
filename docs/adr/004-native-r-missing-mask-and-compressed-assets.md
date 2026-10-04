# ADR 004 — R-Missing-Maske im Worker setzen und komprimierte Dateiformate unverändert liefern

Status: umgesetzt, P5-Dreiermatrix am 2026-10-04 bestanden.

Der installierte webR-0.6.0-Build liefert beim nativen `RDouble([null, NaN, ...])` unter Chromium unterscheidbare NA/NaN, unter Firefox dagegen zwei NaN. Die reproduzierbare API-Probe `tests/integration/r-api.spec.ts` zeigte am 2026-10-04 in Firefox `missing=[false,false,...]`; eine reine TypeScript-Typprüfung genügt nicht. Unveränderter Datentypvertrag: fehlend und gültiges NaN müssen unterscheidbar bleiben.

Die eigene separate Validity-Maske bleibt der Transportvertrag. Nach Bindung des nativen Vektors werden fehlende Positionen mit einer booleschen Maske innerhalb von R auf NA gesetzt; der Rückweg liest `is.na(x) & !is.nan(x)` getrennt vom TypedArray. Keine R-NA-Bitpayload-Zusage über Browser-JavaScript-Grenzen, keine JSON-null-Konversion nichtendlicher Werte. Die API-Probe wird um genau diese Produktionskorrektur erweitert; die fachlichen Sollwerte bleiben NA, NaN, ±Inf und unveränderte ganze Zahlen.

Unabhängig davon dekodierte Vites Dateiserver `.gz`/`.tgz` durch HTTP-Content-Encoding vorzeitig. webR braucht diese Dateien als komprimierte Bytes und dekodiert selbst. Die Dev-/Preview-Middleware liefert sie ohne Content-Encoding; der Regressionstest prüft Gzip-Magic und echten R-Date-Parser. webR-Binaries/JavaScript bleiben bytegleich zu `node_modules`. Die gleiche Auslieferungsregel muss P7 für den statischen Server übernehmen.

Alternativen verworfen: NA und NaN vereinheitlichen (Vertragsverletzung); webR-Quellen patchen oder Paket-Majorupdate (unnötig); Datumsparser deaktivieren (verdeckt den Auslieferungsfehler).

P6-Nachprüfung des skalaren Parameterpfads: `RList({missing: null})` liefert keinen R-NULL-Eintrag. Für den ausdrücklich angebotenen NULL-Parameter bindet der Adapter daher das geprüfte persistente `WebR.objs.null`; Tabellen-NULL bleibt weiterhin NA mit Validity-Maske. `tests/integration/r-snapshots.spec.ts` prüft diese Unterscheidung, typisierte Textparameter, Auswahl-/Parametersnapshot, Seed und aktuellen Objekt-Capture.
