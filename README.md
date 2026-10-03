# Datenwerkstatt V1 — Spezifikationspaket

Dieses Paket ist ein Arbeitsauftrag für einen LLM-Coding-Agenten: **80 verbindliche Anforderungen**, eigene TypeScript-Verträge, Implementierungsphasen, Abnahmeszenarien und synthetische Testdaten. Es ist keine bereits implementierte Webanwendung.

## Einstieg

Paket in das autorisierte neue Zielrepository übernehmen. Vorhandene Dateien/Anweisungen nicht überschreiben, sondern zusammenführen. Den Text aus [PROMPT.md](PROMPT.md) an den Coding-Agenten geben.

| Datei | Zweck |
|---|---|
| [AGENTS.md](AGENTS.md) | Arbeitsregeln und Qualitätsgrenzen für den Agenten |
| [SPEC.md](SPEC.md) | Verbindlicher Produkt-, Architektur-, Daten-, UI- und Betriebsvertrag |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Reihenfolge P0–P8, konkrete Lieferobjekte und Phasengates |
| [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) | Nachprüfbare Szenarien und Requirement-Zuordnung |
| [contracts/domain.ts](contracts/domain.ts) | Serialisierbares Fachmodell |
| [contracts/ports.ts](contracts/ports.ts) | Eigene Infrastruktur-/Runtime-Schnittstellen |
| [contracts/catalog.ts](contracts/catalog.ts) | Katalogindex und aufgelöste Quellen |
| [contracts/archive.ts](contracts/archive.ts) | .dwproj-Projektarchiv |
| [contracts/runtime-config.ts](contracts/runtime-config.ts) | Betreiberkonfiguration und Pilotlimits |
| [fixtures/README.md](fixtures/README.md) | Testdaten, genaue Schemata und erwarteter SQL–R–SQL-Ablauf |
| [docs/SOURCES.md](docs/SOURCES.md) | Quellcodebaseline und offizielle technische Referenzen |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | Was am Spezifikationspaket tatsächlich geprüft wurde |

## Abgrenzung

V1: lokale Arbeitsbereiche, mehrere Datenquellen, SQL, R, Austausch, Speicherung und Projektarchive. Keine KI, Anmeldung, Freigaben, ClickHouse-Ausführung, Notebook-/Canvas-Plattform oder allgemeine Pluginarchitektur.

Der Portaladapter nutzt die bereits vorhandenen `explore/context.json`-Endpunkte. Ein optionaler kleiner Suchindex ist ausdrücklich ein neuer Vertrag. Das Portal muss für den ersten funktionierenden URL-/Deep-Link-Einstieg nicht als Anwendung umgebaut werden.

## Paketprüfung

`python tools/verify-package.py` prüft Dokumentlinks, Requirement-/Test-Zuordnung, Fixture-Sollwerte und Manifestreferenzen des Pakets. `tsc -p contracts/tsconfig.json` prüft die eigenen TypeScript-Verträge. Diese Prüfungen ersetzen nicht die im Zielprojekt noch zu implementierenden Browser-, Engine- und E2E-Tests.

Keine Schriftdateien oder vermeintlich offiziellen Logos aus generierten Mockups sind enthalten. Originalbranding aus dem vorhandenen kantonalen Assetbestand beziehen und Herkunft/Lizenz dokumentieren.
