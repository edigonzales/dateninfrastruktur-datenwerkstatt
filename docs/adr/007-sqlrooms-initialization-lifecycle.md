# ADR-007 — Kontrollierter SQLRooms-Start und Freigabe bei Initfehlern

Status: implementiert, Gateprüfung läuft. SQLRooms 0.28.0 / DuckDB-WASM 1.33.1-dev57.0.

`createRoomStore()` initialisiert im installierten Export alle Slices automatisch. Das umging die Assetvorprüfung der WorkspaceSession und startete bei einem fehlenden WASM bereits einen Worker. Nachweis: `p7-deploy-sixth.log`, erwartete Workerzahl 0, tatsächlich 1. Der Store wird nun mit dem vorhandenen Zustand-`createStore` und unveränderten SQLRooms-Slices aufgebaut; die Session ruft `room.initialize()` erst nach erfolgreicher Assetprüfung auf. Ein Connector bleibt Eigentum genau einer Session; kein zusätzlicher Query-/Projektstore.

Ein GET mit beschädigten WASM-Bytes trotz korrektem HEAD/MIME liess `instantiate()` ohne Antwort hängen. Der echte Browserproof `p7-sql-init-before.log` endete nach 120 Sekunden mit Exit 1. Die Anwendung begrenzt jetzt auch die Initialisierung auf das konfigurierte SQL-Zeitbudget. Beim Ablauf wird nach Cancel-Grace wirklich `AsyncDuckDB.terminate()` ausgeführt. Der neue Test prüft geschlossene Worker und danach SELECT 42 in einer einzigen neuen Runtime.

Der installierte WasmDuckDbConnector setzt in seinem catch die Workerreferenz auf null, ohne den Worker zu beenden; seine Blob-URL wird nur nach erfolgreicher Instanziierung freigegeben. `scripts/patch-sqlrooms.mjs` korrigiert ausschliesslich diese Ressourceneigentümerschaft: terminate/catch geben die URL frei, catch beendet den Worker vor dem Zurücksetzen. SHA-256 des Original- und Zielmoduls werden geprüft; andere Versionen schlagen geschlossen fehl. `postinstall` macht die Anpassung auf einem frischen npm-ci reproduzierbar. Original-Lizenz bleibt erhalten. Keine Änderung an DuckDB/webR-Binaries, keine Majorupdates.

Alternativen: neue SQLRooms-Version ungeprüft übernehmen, den Connector vollständig kopieren oder einen globalen Worker-Hook verwenden. Diese Wege sind grösser bzw. beeinflussen fremde Worker. Die begrenzte Anpassung kann nach einem nachgewiesenen Upstreamfix entfernt werden. Source Maps des betroffenen Drittmoduls beschreiben weiterhin den Originalstand; der Patch ist als eigene Quelle Teil der Distribution/Quelllieferung.

Betroffen: AT-002/024/031/069/071. Fehlschläge und erfolgreiche Wiederholungen werden getrennt in IMPLEMENTATION_STATUS.md geführt. Der unveränderte rohe SQLRooms-Connector allein ist weiterhin kein Timeoutvertrag.
