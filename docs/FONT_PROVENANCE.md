# Herkunft und Nutzung der Schriften

## Frutiger

Am **10. Oktober 2026** hat der Projektverantwortliche die Verwendung und lokale
Auslieferung der vorhandenen Frutiger-Webfonts in der Datenwerkstatt bestätigt:

> Ich bestätige dir, dass das erlaubt ist. Wir haben die notwendigen Lizenzen im Kanton.

Diese Bestätigung beantwortet ausdrücklich die Frage nach der Verwendung und
Auslieferung aus den Referenzprojekten. Sie dokumentiert den kantonalen
Nutzungskontext; die Fonts bleiben proprietär und erhalten durch die
Repository-Lizenz keine zusätzliche Lizenz.

Auf ausdrücklichen Wunsch des Projektverantwortlichen stammt die endgültige
Auswahl aus **datenportal-sodata**, unverändert aus
`src/main/resources/static/vendor/so-web-components/0.1.10/styles/`,
Revision `a742dee42a26c4739e1966b86bae0d37d76ca2f6`.

| Datei                       | CSS-Gewicht wie im Portal | Metadaten                      |
| --------------------------- | ------------------------- | ------------------------------ |
| FrutigerLTW05-55Roman.woff2 | 400                       | Version 1.00, OS/2-Gewicht 400 |
| FrutigerLTW05-75Black.woff2 | 700                       | Version 1.10, OS/2-Gewicht 800 |

Die CSS-Zuordnung 400/700 entspricht der `fonts.css` des Portals: dort wird der
75Black-Schnitt für 700 verwendet, obwohl sein internes Gewicht 800 ist.
Labels und Überschriften verwenden damit dieselbe Schrift wie das Portal.
Die zuvor übernommenen LTCom-Dateien des Datenblatt-Editors wurden ersetzt.
Die eingebetteten Copyright- und Lizenzhinweise sind zusätzlich als
[Originalhinweise](../licenses/frutiger-original-notices.txt) übernommen.
[Assetinventar und SHA-256](../src/assets/ui-assets.json) sichern die Herkunft.

Die Fonts liegen unter `src/assets/fonts/`, werden durch Vite mit lokalem,
unterpfadfähigem URL eingebunden und verwenden `font-display: swap`.
Bei Ladefehlern greift system-ui, -apple-system, BlinkMacSystemFont, Segoe UI,
sans-serif. Es gibt keine externe Fontabfrage und keine Laufzeitabhängigkeit
auf die Referenzrepositories.

## JetBrains Mono und SVGs

JetBrains Mono Regular **2.304** stammt unverändert aus
`datenportal-sodata/src/main/resources/static/vendor/jetbrains-mono/2.304/`.
Die [Original-OFL](../licenses/jetbrains-mono-2.304-OFL.txt) ist enthalten.
Bootstrap Icons **1.13.1** stammt aus dem installierten Originalpaket des
Datenblatt-Editors; ausgewählte SVG-Pfade und die [MIT-Lizenz](../licenses/bootstrap-icons-1.13.1.txt)
sind lokal übernommen. Versionen und Dateihashes stehen im Assetinventar.
