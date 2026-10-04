# ADR-008 — Fortsetzbarer SAB-Interrupt in webR 0.6.0

Status: implementiert, Deployment-Gate läuft. Betroffen: AT-046/068/071, isoliertes auto-Profil.

Der echte isolierte Container meldete bei einer laufenden R-Endlosschleife nach Abbruch Workerreset statt Wiederverwendung. Der minimale Vergleich `verification/p7-sab-direct-proof.json` verwendet denselben nativen SharedArrayBuffer-Kanal, dieselben lokalen unveränderten R-/WASM-Dateien, `repeat {1+1}` und `interrupt()` nach 500 ms:

- `interactive:false`: UnwindProtectException nach ca. 503 ms; anschliessendes `6*7` blieb bis zum kontrollierten Probe-Timeout unbeantwortet. Probe schloss danach den Worker.
- `interactive:true`: dieselbe Interrupt-Exception nach ca. 503 ms; derselbe Worker lieferte danach 42.

Die installierte `WebROptions.interactive`-API ist in `dist/webR/webr-main.d.ts` deklariert. Nur für das tatsächlich isolierte auto-Profil wird sie eingeschaltet; PostMessage bleibt unverändert nichtinteraktiv mit echtem Workerreset. R führt weiterhin nur auf expliziten Run aus. Dies fügt keine REPL-Oberfläche oder automatische Antworten auf Benutzereingaben hinzu; interaktiv wartender Benutzer-Code bleibt dem normalen Timeout/Reset unterworfen. Das Kommunikationsprofil kann deshalb `interactive()` in Benutzer-R unterscheiden; es gehört zur Betriebsdokumentation.

Ein komplettes webR-Upgrade, eine Veränderung der WASM-Datei oder das Verstecken des Resets als erfolgreicher Interrupt wäre grösser bzw. sachlich falsch. Die kleinste kompatible Einstellung wird mit Workerzählung, echtem Loop-Cancel und einer nachfolgenden R-Berechnung getestet. Die 2s-Abbruch-Grace bleibt unverändert, ein nicht antwortender Worker wird weiterhin beendet.
