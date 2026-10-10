# Nativer Safari-Smoke — 10. Oktober 2026

Prüfung über die native Safari-Oberfläche (Safari 27.0.1) auf macOS, eigenes Fenster und Test-Origin
`http://127.0.0.1:4184`. Kein Playwright-WebKit als Safari ausgegeben.

- Komponentenreferenz: sichtbare Labels, Hinweise und Fehler; lokale Schriftladung
  ausdrücklich als „JetBrains Mono: geladen“ über die FontFace-API in der Referenz angezeigt.
- Menü mit Tastatur: End/Letzte Aktion, Home und Pfeiltasten; Escape schliesst und
  Fokus kehrt nachweislich zum Auslöser „Weitere Aktionen“ zurück.
- Nativer Dialog: Shift+Tab vom ersten Eingabefeld auf „Übernehmen“, Tab zurück;
  Escape schliesst und Fokus kehrt zu „Dialog öffnen“ zurück.
- Safari-Zoom über die echten Browsercontrols auf 200 % gestellt, Wert im Page Menu
  abgelesen. Dialog, Label, Warnhinweis und beide Aktionen vollständig sichtbar;
  nach der Tooltipkorrektur kein horizontaler Scrollbalken mehr in dieser Ansicht.
- Vorhandene synthetische Golden-Grafik auf Origin 4184 im nativen Vollbild geöffnet.
  Anfangs übergrosse Grafik mit verdrängten Aktionen; korrigiertes Flexlayout erneut
  geprüft: gesamte Grafik und Aktionsleiste gemeinsam im Bild. Escape verlässt Vollbild.
- Zoom wieder auf 100 % zurückgesetzt; eigenes Referenzfenster geschlossen.
  Ursprüngliches Safari-Fenster auf Origin 4173 erhalten. Keine Skripte gestartet,
  keine Projekte/Browserdaten gelöscht, kein Safari-Prozessneustart vorgenommen.

Befundgrenze: UI-Smoke, keine neue vollständige native Safari-Engine-/Persistenzmatrix.
Screenshots und AX-Zustände wurden während der nativen Bedienung direkt geprüft;
reproduzierbare lokale PNG-/Geometriebelege liefern daneben die automatisierten UI-Tests.
Der historische Safari-Clipboard-Diagnosepunkt aus P8 wird durch diesen Smoke nicht
als behoben bewertet.

## Nachprüfung mit endgültigen sodata-Fonts

Nach der ausdrücklich gewünschten Quelländerung ein frisches eigenes Safari-Fenster
auf `/tests/design-system/` geladen: Frutiger **400 und 700** sowie JetBrains Mono
werden über die FontFace-API als **geladen** angezeigt. Die lokal ausgelieferten
Frutiger-Dateien sind bytegleich zu sodata (separater Hashbeleg).
Menü erneut mit End/Home/Escape geprüft: Fokusrückgabe zum Auslöser. Dialog erneut
mit Shift+Tab/Tab geprüft: letzter Button und erstes Feld bleiben im Fokusfang.
Native Zoomauswahl ausdrücklich **200 %**, Dialog mit Label, Eingabe, vollständigem
Hinweistext und beiden Aktionen visuell geprüft; Escape gibt Fokus an „Dialog öffnen“
zurück. Das neue Prüffenster war anschliessend nicht mehr im Vordergrund; keine
weitere Bedienung des ursprünglichen Nutzerprojekts. Für diese Nachprüfung wird
kein zusätzlich verifizierter Zoom-Reset behauptet. Die Vollbildprüfung stammt
vom vorherigen Smoke mit identischem Plotlayout; automatische Vollbildtests werden
mit dem endgültigen Fontstand in allen drei Playwright-Browsern wiederholt.
