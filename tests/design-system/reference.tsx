import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {
  ActionGroup,
  Button,
  EmptyState,
  FileInput,
  FormField,
  IconButton,
  Input,
  Notice,
  PanelHeader,
  Select,
  StatusBadge,
  Textarea,
  Toolbar,
} from '../../src/ui/Controls';
import {ActionMenu} from '../../src/ui/ActionMenu';
import {Modal} from '../../src/ui/Modal';
import {NavigationItem} from '../../src/ui/NavigationItem';
import '../../src/styles/app.css';
import './reference.css';
function FontStatus({font, weight = 400}: {font: string; weight?: number}) {
  const [fontStatus, setFontStatus] = useState('wird geladen');
  useEffect(() => {
    void document.fonts.load(`${weight} 16px "${font}"`).then(
      (faces) =>
        setFontStatus(
          faces.some((face) => face.status === 'loaded') ? 'geladen' : 'Systemfont-Fallback',
        ),
      () => setFontStatus('Systemfont-Fallback'),
    );
  }, [font, weight]);
  return (
    <output aria-label={`Fontstatus ${font} ${weight}`}>
      {font} {weight}: {fontStatus}
    </output>
  );
}
function Reference() {
  const [modal, setModal] = useState(false),
    [submitted, setSubmitted] = useState(0),
    [action, setAction] = useState('Keine Aktion');
  return (
    <main className="reference">
      <h1>Komponentenreferenz</h1>
      <p>Entwicklungsansicht ohne Workspace, DuckDB oder webR.</p>
      <section>
        <PanelHeader title="Aktionen" />
        <ActionGroup data-testid="variants">
          {(['primary', 'secondary', 'ghost', 'danger'] as const).map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
          <Button disabled>Deaktiviert</Button>
          <Button busy>Wird gespeichert</Button>
          <IconButton icon="gear" label="Optionen" tooltip="Optionen der Arbeitsfläche" />
        </ActionGroup>
        <Toolbar>
          <Button variant="primary" icon="play-fill">
            Kompakt ausführen
          </Button>
          <Button>Speichern</Button>
        </Toolbar>
        <ActionGroup data-testid="wrapped-actions" className="reference-wrap">
          <Button>Grafik Vollbild</Button>
          <Button>PNG herunterladen</Button>
          <Button>Grafik aufbewahren</Button>
        </ActionGroup>
      </section>
      <section>
        <PanelHeader title="Formulare" />
        <form
          className="reference-form"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted((n) => n + 1);
          }}
        >
          <p className="dw-required-note">* Pflichtfeld</p>
          <FormField label="Projektname" hint="Ein eindeutiger Name für das Projekt.">
            <Input required name="project" />
          </FormField>
          <FormField
            label="Ein langes Label, das bei schmalen Ansichten auf mehrere Zeilen umbrechen darf"
            error="Der angegebene Name ist ungültig. Bitte einen anderen Namen verwenden."
          >
            <Input defaultValue="Fehler" />
          </FormField>
          <FormField label="Beschreibung">
            <Textarea />
          </FormField>
          <FormField label="Modus">
            <Select>
              <option>Lokal</option>
              <option>Sitzung</option>
            </Select>
          </FormField>
          <FormField label="Originaldatei behalten">
            <Input type="checkbox" />
          </FormField>
          <FormField label="Erste Auswahl">
            <Input type="radio" name="selection" defaultChecked />
          </FormField>
          <FormField label="Zweite Auswahl">
            <Input type="radio" name="selection" />
          </FormField>
          <FormField label="Datei">
            <FileInput />
          </FormField>
          <ActionGroup>
            <Button onClick={() => setAction('Vorschau')}>Vorschau</Button>
            <Button variant="primary" type="submit">
              Formular senden
            </Button>
          </ActionGroup>
          <output aria-label="Formularstatus">{submitted} gesendet</output>
        </form>
      </section>
      <section>
        <PanelHeader title="Status und Meldungen" />
        <ActionGroup>
          {(['neutral', 'info', 'success', 'warning', 'danger'] as const).map((tone) => (
            <StatusBadge tone={tone} key={tone}>
              {tone}
            </StatusBadge>
          ))}
        </ActionGroup>
        <Notice>Information: Die Vorschau zeigt die ersten 200 Zeilen.</Notice>
        <Notice tone="success">Erfolg: Lokal gespeichert.</Notice>
        <Notice tone="warning">Warnung: Nur in dieser Sitzung verfügbar.</Notice>
        <Notice tone="danger">
          Fehler: Die Datei konnte nicht gelesen werden. Diese lange Meldung muss umbrechen und darf
          keine Aktionen verdecken.
        </Notice>
        <EmptyState>Noch keine Daten.</EmptyState>
        <pre>SELECT 'JetBrains Mono' AS schrift;</pre>
        <ActionGroup>
          <FontStatus font="Frutiger" />
          <FontStatus font="Frutiger" weight={700} />
          <FontStatus font="JetBrains Mono" />
        </ActionGroup>
      </section>
      <section>
        <PanelHeader title="Menü und Dialog" />
        <ActionGroup>
          <ActionMenu
            actions={[
              {label: 'Erste Aktion', onSelect: () => setAction('Erste Aktion')},
              {label: 'Nicht verfügbar', disabled: true, onSelect: () => {}},
              {label: 'Letzte Aktion', onSelect: () => setAction('Letzte Aktion')},
            ]}
          />
          <Button onClick={() => setModal(true)}>Dialog öffnen</Button>
        </ActionGroup>
        <output aria-label="Aktionsstatus">{action}</output>
        {modal && (
          <Modal
            title="Beispieldialog"
            onClose={() => setModal(false)}
            footer={
              <Button variant="primary" onClick={() => setModal(false)}>
                Übernehmen
              </Button>
            }
          >
            <FormField label="Dialogname">
              <Input />
            </FormField>
            <Notice tone="warning">
              Lange Beschriftungen und Hinweise bleiben vollständig lesbar.
            </Notice>
          </Modal>
        )}
      </section>
      <section>
        <PanelHeader title="Navigation" />
        <div className="reference-navigation">
          <nav className="sidebar" aria-label="Referenznavigation">
            <NavigationItem
              icon="database"
              label="SQL"
              tooltip="SQL · DuckDB"
              expanded={false}
              current
            >
              <Button />
            </NavigationItem>
            <NavigationItem icon="bar-chart-line" label="R" tooltip="R · webR" expanded={false}>
              <Button />
            </NavigationItem>
          </nav>
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Reference />);
