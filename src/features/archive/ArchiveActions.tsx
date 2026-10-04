import {useState, useSyncExternalStore} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {services} from '../../app/services';
import {downloadStream} from '../../app/download';
import {report, router as routerApi} from '../../app/router';
import {Modal} from '../../ui/Modal';
import type {EditingSession} from '../../application/workspaceService';
import type {ArchiveCandidate} from '../../application/workspaceArchive';
export function ArchiveImport() {
  const [candidate, setCandidate] = useState<ArchiveCandidate>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const navigate = useNavigate();
  return (
    <section>
      <label>
        Projektdatei importieren
        <input
          type="file"
          accept=".dwproj,.zip"
          disabled={busy || !services.workspaces.canCreate}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            setMessage('');
            void services.workspaces
              .getArchive()
              .inspect(file, new AbortController().signal)
              .then(setCandidate)
              .catch(report)
              .finally(() => setBusy(false));
          }}
        />
      </label>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void services.workspaces
            .cleanAbandoned(new AbortController().signal)
            .then((r) =>
              setMessage(
                `${r.removed.length} verwaiste Dateien aus entfernten/abgebrochenen Projekten bereinigt. ${r.failures.join('; ')}`,
              ),
            )
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        Reste abgebrochener Projekte bereinigen
      </button>
      {busy && <p role="status">Archiv wird geprüft/verarbeitet …</p>}
      {message && <p role="status">{message}</p>}
      {candidate && (
        <Modal
          title="Projektimport bestätigen"
          onClose={() => {
            if (!busy) {
              setCandidate(undefined);
              services.workspaces.getArchive().discard();
            }
          }}
        >
          <p>
            {candidate.inspection.workspaceName}: {candidate.inspection.datasets} Datensätze ·{' '}
            {candidate.inspection.analyses} Analysen · {candidate.inspection.includedBytes} Bytes.
          </p>
          <p>
            {candidate.inspection.containsExecutableCode
              ? 'Enthält SQL-/R-Code. Dieser wird beim Import nicht ausgeführt.'
              : 'Kein ausführbarer Analysecode enthalten.'}{' '}
            Alle internen IDs werden neu vergeben.
          </p>
          {candidate.inspection.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void services.workspaces
                .importArchive(candidate.id, new AbortController().signal)
                .then(async (d) => {
                  setCandidate(undefined);
                  await navigate({
                    to: '/workspaces/$workspaceId',
                    params: {workspaceId: d.workspace.id},
                  });
                })
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            Als neuen Arbeitsbereich importieren
          </button>
        </Modal>
      )}
    </section>
  );
}
export function ArchiveActions({session}: {session: EditingSession}) {
  useSyncExternalStore(session.persistence.subscribe, () => session.persistence.document);
  const doc = session.document;
  const [dialog, setDialog] = useState<'export' | 'delete'>(),
    [mode, setMode] = useState<'recipe' | 'with-data'>('with-data'),
    [keep, setKeep] = useState(true),
    [external, setExternal] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [message, setMessage] = useState('');
  const [integrity, setIntegrity] = useState(session.integrity);
  const navigate = useNavigate();
  const temporary = Object.values(doc.results).filter(
    (r) => r.materialization.kind === 'session',
  ).length;
  const references = Object.values(doc.datasetVersions).filter(
    (v) => v.backing.kind === 'public-parquet',
  ).length;
  const missing =
    Object.values(doc.datasetVersions).filter((v) => v.backing.kind === 'missing').length +
    (integrity?.missing.length ?? 0) +
    (integrity?.corrupt.length ?? 0);
  const act = (work: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    void work()
      .catch(report)
      .finally(() => setBusy(false));
  };
  return (
    <section className="archive-actions">
      <h2>Projektdatei und Speicher</h2>
      <button disabled={busy} onClick={() => setDialog('export')}>
        Projekt exportieren
      </button>
      <button
        disabled={busy || !services.workspaces.canCreate}
        onClick={() =>
          act(async () => {
            const d = await services.workspaces.duplicate(
              doc.workspace.id,
              new AbortController().signal,
            );
            await navigate({to: '/workspaces/$workspaceId', params: {workspaceId: d.workspace.id}});
          })
        }
      >
        Arbeitsbereich duplizieren
      </button>
      <button
        disabled={busy || session.readOnly}
        onClick={() =>
          act(async () => {
            await session.flush();
            setRevision(session.document.revision);
            setDialog('delete');
          })
        }
      >
        Arbeitsbereich löschen
      </button>
      <button
        disabled={busy}
        onClick={() =>
          act(async () => {
            const checked = await session.inspectIntegrity(new AbortController().signal, true);
            setIntegrity(checked);
            setMessage('Dateilängen und SHA-256 geprüft.');
          })
        }
      >
        Integrität prüfen
      </button>
      {integrity && (
        <p role="status">
          {integrity.missing.length} fehlende · {integrity.corrupt.length} beschädigte ·{' '}
          {integrity.orphanPaths.length} verwaiste Dateien.{' '}
          {session.hashesChecked
            ? 'Hashprüfung ausgeführt.'
            : 'Inventar geprüft; Hashprüfung erfolgt vor Verwendung oder ausdrücklich hier.'}
        </p>
      )}
      {!!missing && (
        <p role="alert">
          Betroffene Daten sind nicht verfügbar. Code und Herkunft bleiben erhalten. Daten über
          „Daten ersetzen“ als neue Version wieder einbinden.
        </p>
      )}
      {session.integrityError && (
        <p role="alert">Dateiinventar konnte nicht geprüft werden: {session.integrityError}</p>
      )}
      {message && <p role="status">{message}</p>}
      {dialog === 'export' && (
        <Modal
          title="Projekt exportieren"
          onClose={() => {
            if (!busy) setDialog(undefined);
          }}
        >
          <label>
            Archivmodus
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value as 'recipe' | 'with-data')}
            >
              <option value="with-data">Mit Daten</option>
              <option value="recipe">Rezept ohne lokale Bytes</option>
            </select>
          </label>
          <p>
            {Object.keys(doc.datasets).length} Datensätze · {Object.keys(doc.results).length}{' '}
            Resultate · {Object.values(doc.artifacts).reduce((n, a) => n + a.bytes, 0)} bekannte
            lokale Bytes.
          </p>
          <p>
            {temporary} temporäre Resultate · {references} externe Datenstände · {missing}{' '}
            fehlende/beschädigte Datenstände. Auslassungen werden im Archiv dokumentiert; externe
            oder fehlende Quellen sind nicht offline verfügbar.
          </p>
          {mode === 'with-data' && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={keep && !session.readOnly}
                  disabled={busy || session.readOnly}
                  onChange={(e) => setKeep(e.target.checked)}
                />
                Temporäre Resultate vor Export aufbewahren
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={external}
                  disabled={busy}
                  onChange={(e) => setExternal(e.target.checked)}
                />
                Externe Quellen ebenfalls sichern
              </label>
            </>
          )}
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                const result = await session.exportArchive(
                  mode,
                  {keepTemporary: keep && !session.readOnly, includeExternal: external},
                  new AbortController().signal,
                );
                await downloadStream(
                  result.blob.stream(),
                  'datenwerkstatt.dwproj',
                  'application/zip',
                );
                setMessage(
                  result.manifest.omissions.length
                    ? `Archiv exportiert mit ${result.manifest.omissions.length} ausdrücklich dokumentierten Auslassungen.`
                    : 'Archiv mit sämtlichen gespeicherten Datenständen exportiert.',
                );
                setDialog(undefined);
              })
            }
          >
            Archiv herunterladen
          </button>
        </Modal>
      )}
      {dialog === 'delete' && (
        <Modal
          title="Arbeitsbereich endgültig löschen?"
          onClose={() => {
            if (!busy) setDialog(undefined);
          }}
        >
          <p>
            {doc.workspace.name}: {Object.keys(doc.datasets).length} Datensätze,{' '}
            {Object.keys(doc.analyses).length} Analysen und{' '}
            {Object.values(doc.results).filter((r) => r.retention === 'kept').length} gesicherte
            Resultate werden gelöscht. Laufende Jobs werden beendet. Ein heruntergeladenes Archiv
            bleibt bestehen.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                const failures = await services.workspaces.deleteWorkspace(
                  doc.workspace.id,
                  revision,
                );
                setDialog(undefined);
                if (failures.length)
                  report(
                    new Error(
                      `Projekt gelöscht; ${failures.length} Dateireste sind über die Arbeitsbereichsliste bereinigbar.`,
                    ),
                  );
                await routerApi.invalidate();
                await navigate({to: '/workspaces'});
              })
            }
          >
            Endgültig löschen
          </button>
        </Modal>
      )}
    </section>
  );
}
