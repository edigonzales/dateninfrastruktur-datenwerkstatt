# Designsystem Datenwerkstatt

Version 1.0 · 10. Oktober 2026 · Gestaltungsvertrag für die bestehende React-Anwendung.

Dieses Dokument konkretisiert REQ-061–067 und AT-054–058. Funktionale Verträge,
Engine-Lebenszyklen und Speicherformate bleiben in SPEC und contracts verbindlich.
Referenzen sind das Datenportal sodata (Farbwelt, Flächen, semantische Primitive)
und der Datenblatt-Editor (Formulare und Abstandsraster). Es entsteht zunächst
kein gemeinsames Paket und keine Änderung an diesen Anwendungen.

## Farben und Hintergründe

| Rolle                                         | Wert              |
| --------------------------------------------- | ----------------- |
| Seite, Navigation, Editor, Resultate, Dialoge | #FFFFFF           |
| Werkzeugleisten, Tabellenköpfe, Konsole       | #F4F7F9           |
| Neutrale Statuslabels                         | #EEF2F5           |
| Neutraler Hover                               | #E1E8EF           |
| Aktive Navigation                             | #FDEBEC           |
| Haupttext                                     | #2F4858           |
| Sekundärtext/Hilfetext                        | #536779           |
| Primäraktion / Hover                          | #D20A11 / #B80F17 |
| Trennlinie                                    | #D9E0E6           |
| Eingaberand                                   | #7C8B97           |
| Fokus                                         | #0B5FFF           |
| Information: Text / Fläche                    | #2D5F87 / #E8F2FB |
| Erfolg: Text / Fläche                         | #2F7D4E / #E7F6EC |
| Warnung: Text / Fläche                        | #8A5A00 / #FFF3E0 |
| Fehler: Text / Fläche                         | #B80F17 / #FDEBEC |

Der Seitenhintergrund ist Weiss, nicht das bisherige #F6F6F7. Flächen werden
über Abstand, feine Trennlinien und zurückgesetzte Funktionsbereiche gegliedert.
Status ist immer auch als Text erkennbar. Textkontrast mindestens 4.5:1;
Trennlinien dienen nicht allein der Erkennung von Eingabefeldern.
Controls und Dialoge haben 4 px Radius. Schatten nur für schwebende Elemente.

## Typografie

Die Oberfläche verwendet lokal ausgelieferte **Frutiger LT W05 55Roman (400) und 75Black (700)**
mit derselben CSS-Gewichtszuordnung wie das Referenzportal sodata.
Die kantonalen Lizenzen und die Verwendung/Auslieferung in dieser Anwendung wurden
am 10. Oktober 2026 durch den Projektverantwortlichen bestätigt.
[Herkunft, Originalhinweise und Nutzungskontext](FONT_PROVENANCE.md) sind dokumentiert.
Bei Ladefehlern bleibt system-ui, -apple-system, BlinkMacSystemFont, Segoe UI,
sans-serif als Fallback aktiv; `font-display: swap` erhält die sofortige Lesbarkeit.

Code und Konsole verwenden lokal JetBrains Mono 2.304 (OFL-1.1), aus dem
versionierten Portalbestand. Herkunft und Originalhinweise werden mitgeliefert.
Keine externen Fontabrufe. Fontpfade müssen auch unter /lab/ funktionieren.

| Verwendung           | Grösse / Gewicht              |
| -------------------- | ----------------------------- |
| Seitentitel          | 28 px / 700                   |
| Abschnittstitel      | 20 px / 700                   |
| Standardtext         | 16 px / 400                   |
| Kompakte Bedienung   | 14 px / 400                   |
| Ergänzende Metadaten | 12 px / 400                   |
| Formularlabel        | 14 px / 700, Zeilenhöhe 20 px |

Editor bleibt standardmässig 14 px und auf 12–22 px einstellbar.

## Abstände und Grössen

Tokens tragen den Präfix --dw-. Raster: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px.

| Beziehung                           | Abstand |
| ----------------------------------- | ------- |
| Icon–Text, benachbarte Buttons      | 8 px    |
| Unterschiedliche Aktionsgruppen     | 16 px   |
| Label–Control und Control–Hilfetext | 8 px    |
| Formularfelder                      | 16 px   |
| Inhaltsabschnitte                   | 32 px   |
| Dialoginnenraum / Seitenrand        | 24 px   |
| Seitenrand bei schmalem Viewport    | 16 px   |

Aktionsgruppen besitzen gap: 8px in beiden Richtungen und dürfen umbrechen.
Keine Leerzeichen oder individuellen Button-Margins zur Layoutsteuerung.
Standardcontrols mindestens 40 px, kompakte Controls mindestens 32 px hoch.
Texte dürfen die Höhe vergrössern; lange Beschriftungen werden nicht abgeschnitten.

## Formulare und Labels

Labels stehen sichtbar linksbündig oberhalb der Eingabe, Farbe #2F4858.
Hilfetext folgt darunter in 14 px / 400 und #536779. Fehlermeldungen nennen
konkret das Problem und werden dem Feld über aria-describedby zugeordnet;
aria-invalid kennzeichnet ungültige Eingaben. Placeholder ersetzt kein Label.
IDs und htmlFor verbinden Label und Control; bestehende IDs werden erhalten.
Pflichtfelder erhalten ein sichtbares Sternchen und native required-Semantik;
einmal pro Formular wird „\* Pflichtfeld“ erklärt. Keine neuen fachlichen
Validierungsregeln allein durch die Designmigration.

Checkboxen und Radiobuttons stehen links, ihre anklickbare Beschriftung rechts
mit 8 px Abstand und normalem Schriftgewicht. Mehrzeilige Texte dürfen umbrechen.
Analysename in einer kompakten Werkzeugleiste darf ein visuell ausgeblendetes
Label haben. Parametertabellen verwenden Spaltenköpfe plus eindeutige zugängliche
Feldnamen. Deaktivierte und schreibgeschützte Werte bleiben lesbar.

## Komponenten und Zustände

- Button/IconButton: primary, secondary, ghost, danger; default/compact.
  Button ist standardmässig type=button; Formular-Submit wird explizit gesetzt.
  Primary für Neuer Arbeitsbereich/Ausführen/abschliessende Bestätigung.
  Sekundäraktionen neutral, destruktive Aktionen räumlich getrennt.
- ActionGroup/Toolbar: gemeinsame Abstände, Reihenfolge und Umbruch.
- FormField/Input/Select/Textarea: native Semantik, Label, Hinweis, Fehler.
- Modal: nativer Dialog mit Kopf, Inhalt, Fuss, Fokusfang und Fokusrückgabe.
  Bestehende Sperren beim laufenden Vorgang bleiben wirksam.
- ActionMenu: Tastaturöffnung, Pfeiltasten, Home/End, Escape und Fokusrückgabe.
- Tooltip: auf Hover und Fokus; Escape blendet aus. Der Auslöser hat selbst
  einen zugänglichen Namen. Tooltip ersetzt keine Beschriftung in Formularen.
- StatusBadge/Notice: nicht interaktiver Zustand bzw. erklärende Meldung.
- NavigationItem/PanelHeader/EmptyState und Tabellenstil: gemeinsame Struktur.

Hover, active, focus-visible, selected, disabled und busy sind definiert.
Busy verhindert Doppelaktionen; Abbrechen bleibt erreichbar. Fokus: 3 px blauer
Ring, 2 px Abstand. Statusmeldungen gezielt über Live-Regionen, nicht pro Tastendruck.

## Bootstrap-SVGs und Navigation

Lokale SVG-Auswahl aus Bootstrap Icons **1.13.1**, MIT-Lizenz inklusive.
Keine Unicode-Ersatzbilder, Iconfonts oder externen Iconabrufe. SVG mit currentColor,
aria-hidden und focusable=false; zugänglicher Name am Auslöser.

| Ziel                  | Icon           |
| --------------------- | -------------- |
| Navigation umschalten | layout-sidebar |
| Arbeitsbereiche       | collection     |
| Projektübersicht      | folder2-open   |
| Daten                 | table          |
| SQL / DuckDB          | database       |
| R / webR              | bar-chart-line |

20×20 px Icons auf mindestens 40×40 px Navigationsflächen. Eingeklappt Tooltip,
ausgeklappt zusätzlich Label. SQL und R behalten ihre Namen; Tooltip ergänzt
DuckDB bzw. webR. Aktives Ziel: rote Tönung, seitlicher Marker, aria-current.

## Arbeitsflächen und Anordnung

Kopf 56 px; Navigation 52 px eingeklappt, 212 px ausgeklappt; SQL/R initial
mit eingeklappter Navigation. Analysenbedienung höchstens weitere 88 px.
Mindestens 75 % Viewporthöhe und 90 % der Breite rechts der Iconleiste für die
Arbeitsflächen bei geschlossenen Zusatzpanels. Bei 900 px Höhe mindestens
180 px SQL-Editor und 220 px Ergebnis. Keine Überlagerung bei geringer Höhe,
Zoom oder Meldungen; dann zugängliches Scrollen. Kein horizontaler Seiten-Overflow
bei 1280×800; Code-/Tabellenscrollen ist erlaubt.

SQL/R: Analysename → Ausführen/Abbrechen → Speichern → Ansichtsaktionen → Weitere
Aktionen. Layoutreset und R-Reset im Menü; Parameter/Optionen einblendbar.
Ergebnis-, Paging- und Grafikaktionen am jeweiligen Ergebnis, mit ActionGroup.
Tabellen bleiben Tabellen; Zahlen nach logischem Typ rechtsbündig, NULL explizit.
Leere Zustände erläutern den nächsten Schritt. Wartung getrennt von Einstiegsaktionen.

## Referenz und Abnahme

Entwicklungsreferenz unter /tests/design-system/ (nur Vite-Entwicklung, nicht
Produktbuild), ohne Workspace/Engine. Zeigt alle Varianten, lange Labels,
Fehler, Pflichtfelder, Lade-/Fokuszustände, Dialoge, Menüs und Umbruch.

Prüfen: 1440×900, 1280×800, geringe Höhe, 200 % Zoom; mindestens 8 px
Aktionsabstand auch beim Umbruch; Labelklick, Checkboxklick, Tastatur, Fokus,
Menü und Tooltip; SQL/R-Flächenvertrag und reale vorhandene Datenpfade.
Neue Screenshots/Messungen separat von historischen P7/P8-Belegen.
Lokale Fonts/SVGs unter /lab/, Fontfehler/Fallback und kein externer Abruf.
Abschluss: npm run verify, E2E zusätzlich Firefox/WebKit, betroffene statische
Deploymentchecks, Dokumentlinks und nativer Safari-UI-Smoke. Nicht ausgeführte
Prüfungen ausdrücklich dokumentieren.
