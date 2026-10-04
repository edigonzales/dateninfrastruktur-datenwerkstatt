# ADR-002 — WebKit-OPFS und Browserprofile

Status: verifizierte Testumgebungsentscheidung, 3. Oktober 2026.

Im flüchtigen Playwright-WebKit-Kontext liefert `navigator.storage.getDirectory()` einen `UnknownError`. Der übrige P0-Lauf hatte 20 bestandene und einen fehlgeschlagenen Fall. Ein neues persistentes WebKit-Profil besteht dieselbe Schreib-Lese-Lösch-Probe.

Die positive Persistenzmatrix verwendet deshalb für jeden Test ein frisches persistentes Profil (`tests/persistentBrowser.ts`). Es werden keine vorhandenen Nutzerprofile verwendet. Alle drei Browser bestehen damit 27 Integrationsfälle. Dies ändert weder Produktanforderungen noch Fehlerbehandlung: verweigerte/fehlende Persistenz benötigt eine reale Capability-Probe und explizite Zustimmung zum Sitzungsmodus in P2. Ein tatsächlicher Safari-Pilot ist weiterhin offen.

## Ergänzung: native Plattformprofile und Ereignisse

Die volle Matrix verwendet Browsernamen mit nativen User-Agents. Die Playwright-Vorgabe „Desktop Firefox“ emuliert einen Windows-User-Agent; auf dem macOS-Runner versendet `ControlOrMeta` jedoch Meta. Monaco wählte aufgrund der emulierten Plattform Ctrl-Bindungen. Ein direkter Browserprobeaufruf mit nativem User-Agent und die anschliessenden gezielten Tests bestätigen den Unterschied. Die positive Matrix emuliert keine andere Betriebssystemplattform.

WebKit liefert `keyboard.insertText` hier zeichenweise: die Änderung zu `SELECT 42 AS wert;` besitzt vier Undo-Gruppen. Der Test geht über dieselbe History bis zum unveränderten Solltext `SELECT 1 AS wert;` und wieder zurück. Geometrie prüft die tatsächliche Editorfläche, nicht Monacos intern teils nullbreite Textarea. Worker-close und Lockfreigabe nach Tabende sind asynchrone Browserereignisse; Tests warten begrenzt auf das tatsächliche Ereignis, ohne Erfolg vorzutäuschen. Siehe `verification/monaco-browser-findings.json`.

P6-Korrektur: Frische WebKit-Profilordner isolieren in diesem Build nicht zuverlässig den nativen OPFS-Bestand. [ADR-005](005-opfs-test-namespaces.md) ersetzt diese frühere Isolationsannahme durch eigene, echte OPFS-Testnamensräume und einen expliziten Zweiprofilnachweis.
