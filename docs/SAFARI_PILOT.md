# Tatsächlicher Safari-Pilot

Stand 4. Oktober 2026: **Bestanden, einschliesslich vollständigem Safari-Prozessneustart.** Safari 27.0.1 (22625.1.29.11.28), macOS 27.0.1 (26A434), Apple M5/24 GiB. Dieser Nachweis stammt aus der installierten Safari-App, nicht aus Playwright-WebKit.

## Ausgeführter Pfad

Eigene Test-Origin `http://127.0.0.1:4184`, unveränderte produktive Dienste und native IndexedDB/OPFS/Web Locks/Worker. Das vorhandene Nutzerprojekt auf Port 4173 wurde nicht verändert. Jeder Versuch erstellt einen eigenen Arbeitsbereich; frühere Testprojekte bleiben erhalten. Keine globale Browserdatenlöschung und keine Änderung des Quellportals.

- Bevölkerung aus synthetischem öffentlichem Parquet; Gemeinden und Fahrzeuge als lokale CSV über Vorschau/Bestätigung.
- Unveränderte Golden-Skripte: SQL mit vier Zeilen, vollständiger Transfer nach R, R-Klassifikation und Rück-SQL mit `hoch=2`, `nicht berechenbar=1`, `niedrig=1`. Führende Nullen und NULL erhalten.
- Echte PNG-Grafik (53 679 Bytes), aufbewahrtes SQL-Resultat, gespeichertes Diagramm, lokale Sicherung der Portalversion und vollständiges Archiv (107 398 Bytes).
- Eigenes Safari-Fenster geschlossen und neues Fenster geöffnet. Gespeicherter Code und Lauf-IDs unverändert, kein Engine-/Code-Autostart beim Öffnen der Metadaten, echte OPFS-Daten wieder lesbar.
- Archiv tatsächlich importiert: neuer Arbeitsbereich/neue IDs, gleicher Code und gleiche Ergebniswerte, kein Auto-Run.
- Laufende R-Endlosschleife abgebrochen: 4 ms, Epoche 0→1, native `Worker.terminate()`-Aufrufe; neue R-Runtime liefert `42`. Alle vom Test gestarteten Worker beim Close terminiert.

[Originalbericht](verification/p8-safari-native-9cc4eeae-dba7-4c6c-a870-909e0bad5595.json), [erfolgreiche Berichtprüfung](verification/p8-safari-assert.log). Der Worker-Test ruft den originalen Browserkonstruktor und dessen `terminate()` auf; er ersetzt keine Engine. Native Worker-Close-Events wurden separat in der automatisierten Browsermatrix geprüft. Ein solcher Event-Nachweis wird für diesen Safari-Pilot nicht behauptet.

Die tatsächliche Safari-UI wurde über native Bedienung geprüft: gesichertes Rück-SQL mit allen drei Ergebniszeilen; Monaco zeigt den unveränderten SQL-/R-Code; aufbewahrter R-Plot mit korrekten Balken 400/600/750, Vollbild und Rückkehr per Escape. Screenshots und Accessibility-Zustände wurden im Prüfchat gesichtet. Keine neue Safari-Geometriemessung bei 1440×900/1280×800 behauptet; diese verbindlichen Messreihen liegen aus der P7/P8-Browsermatrix vor.

## Erstfehler und Abgrenzung

Nach der vom Nutzer aktivierten Remoteautomation scheiterte WebDriver weiterhin an der Verbindung zur Safari-Instanz: zunächst curl-Timeout (Exit 28), danach `session not created` nach 30 Sekunden ([Antwort](verification/p8-safari-session-enabled-second.json)). Deshalb wurde der Pilot direkt in Safari mit nativer UI-Bedienung und einer lokalen Testseite durchgeführt. Keine Safari-Einstellung durch den Agenten geändert.

Der erste neue Testvergleich behandelte DuckDBs `750.0` und den JSON-Sollwert `750` als unterschiedliche Texte. Der [Diagnoselauf](verification/p8-safari-native-e9f5d9b4-8457-4fa3-88e6-2133d53d47e0.json) bewahrt Ist-/Sollwerte und Fehler. Der erste Bericht [08155…](verification/p8-safari-native-08155c51-6874-4c17-b209-afaced0047da.json) enthielt wegen Safaris Stackformat nur den Stack, weshalb die Fehlerausgabe anschliessend um die Meldung ergänzt wurde. Jetzt werden ausschliesslich die kleinen numerischen Fixture-Zellen numerisch verglichen, Text und NULL unverändert exakt. Keine Änderung von Goldenwerten oder Produktcode; beide Fehlversuche bleiben dokumentiert.

Der erfolgreiche Lauf verwendete einen neuen Arbeitsbereich auf derselben Test-Origin nach diesen zwei Versuchen. Kein neuer Safari-Profilordner wird behauptet. Die Archivprüfung im zweiten frischen Profil ist in Chromium/Firefox/Playwright-WebKit nachgewiesen; der native Safari-Pilot importiert in einen neuen Arbeitsbereich derselben Origin.

Nach ausdrücklicher Nutzerfreigabe wurde Safari zusätzlich vollständig beendet und neu gestartet. [Prozessnachweis](verification/p8-safari-process-restart.json): vorher PID 51578, nach Command-Q kein Safari-Prozess, neu PID 26040. Der [anschliessende Persistenztest](verification/p8-safari-native-199dad27-4394-4105-bb98-4212c6839af2.json) besteht: Code, fünf Runs, historische Datasetversionen, gespeichertes Diagramm, PNG mit exakt 53 679 Bytes und Golden-Rück-SQL unverändert, kein Auto-Run. [Gemeinsame Berichtprüfung](verification/p8-safari-assert-restart.log) Exit 0. Die ursprünglichen Nutzerfenster wurden über Safaris Sitzungswiederherstellung wieder geöffnet; eigene Pilotfenster anschliessend geschlossen. Das vorher temporäre Nutzerresultat wird erwartungsgemäss als nicht mehr verfügbar angezeigt; kein Nutzer-Code ausgeführt oder geändert.

## Offener Diagnosebefund

Beim Beenden des Vite-Testservers wurde dessen weitergeleitetes Browserlog ausgewertet: zwei Clipboard-`write`-Fehler und eine unbehandelte `Canceled`-Rejection während der nativen Plot-/Escape-Bedienung. [Ungekürzte Serverausgabe](verification/p8-safari-server.log). Der Stack verweist auf den Safari-spezifischen `installWebKitWriteTextWorkaround` in der tatsächlich installierten Monaco-Datei `node_modules/monaco-editor/esm/vs/platform/clipboard/browser/clipboardService.js:74`. Dort verwirft ein neues Click-/Keydown-Ereignis das vorige ausstehende Clipboard-Promise.

Die geprüften UI-/Engine-/Speicherabläufe wurden dadurch nicht unterbrochen; der Pilot besteht. Eine fehlerfreie Safari-Konsole oder eine umfassend geprüfte Safari-Clipboard-Funktion wird nicht behauptet. Der Befund bleibt offen: reproduzierbaren Copy-/Paste-Fall im fokussierten Editor von Fokuswechsel/Fullscreen abgrenzen, bevor eine produktive Änderung oder ein Dependency-Patch beschlossen wird. Keine Fehlerunterdrückung, kein ungeprüftes Paketupgrade und keine Änderung an Produktbytes.

## Reproduzieren

Nach `npm ci` und `npm run assets:prepare` in zwei Terminals:

```sh
node tests/portal/server.mjs
node tests/safari/server.mjs
```

In Safari `http://127.0.0.1:4184/tests/safari/index.html` öffnen und „Golden Path starten“ anklicken. Nach erfolgreichem Lauf die beiden Links zur echten Anwendung prüfen. Nur das Testfenster schliessen, ein neues Fenster mit derselben Testseite öffnen und „Persistenz, Archiv und Cancel prüfen“ anklicken. Keine gleichzeitig offene Seite desselben Testprojekts zurücklassen, die den Writer-Lock hält.

Für den ergänzenden Prozessneustart zuerst eigene Arbeit in anderen Safari-Tabs sichern, Safari vollständig beenden und neu starten. Dann dieselbe Testseite öffnen und „Nach vollständigem Safari-Neustart prüfen“ anklicken. Der Test prüft Code/Läufe/Herkunft/Diagramm, echte aufbewahrte PNG-Bytes und Rück-SQL ohne Auto-Run. Der Bediener muss den tatsächlichen Prozessneustart zusätzlich dokumentieren; der Button allein beweist ihn nicht.

Die Testseite schreibt zeitgestempelte JSON-Berichte ausschliesslich in `docs/verification/p8-safari-native-<UUID>.json`. Prüfung eines vollständigen Enginepiloten und optional des separaten Neustartberichts:

```sh
node tests/safari/assert-report.mjs PILOT.json [NEUSTART.json]
```

Für die hier gemessene Safari-Version gepinnt; andere Versionen brauchen eine bewusst aktualisierte Browsermatrix. Der Server und die Testseite werden nicht mit dem statischen Produkt ausgeliefert. Nach der Prüfung ausschliesslich die selbst gestarteten Testserver beenden.
