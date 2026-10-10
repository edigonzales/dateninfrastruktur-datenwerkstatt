import {
  Button,
  Input,
  Textarea,
  FormField,
  ActionGroup,
  EmptyState,
  StatusBadge,
  PanelHeader,
} from '../../ui/Controls';
import {Diagnostics} from './Diagnostics';
import {ArchiveActions, ArchiveImport} from '../archive/ArchiveActions';
import {useState} from 'react';
import {Link, useNavigate} from '@tanstack/react-router';
import {useStore} from 'zustand';
import {listRoute, useWorkspace, report} from '../../app/router';
import {services} from '../../app/services';
import {DataSection} from '../data/DataSection';
export function WorkspaceList() {
  const workspaces = listRoute.useLoaderData();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  return (
    <main>
      <h1>Arbeitsbereiche</h1>
      <form
        className="create-workspace"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void services.workspaces
            .create(name)
            .then((d) =>
              navigate({to: '/workspaces/$workspaceId', params: {workspaceId: d.workspace.id}}),
            )
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <FormField label={<>Name des neuen Arbeitsbereichs</>}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </FormField>
        <Button
          type="submit"
          variant="primary"
          icon="plus-lg"
          busy={busy}
          disabled={busy || !services.workspaces.canCreate}
        >
          Neuer Arbeitsbereich
        </Button>
      </form>
      <p className="dw-required-note">* Pflichtfeld</p>
      <ArchiveImport />
      {workspaces.length === 0 ? (
        <EmptyState>
          Noch kein Arbeitsbereich. Lege ein Projekt an oder öffne eine Projektdatei.
        </EmptyState>
      ) : (
        <table className="workspace-list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Daten</th>
              <th>Analysen</th>
              <th>Zuletzt bearbeitet</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.id}>
                <td>
                  <Link to="/workspaces/$workspaceId" params={{workspaceId: w.id}}>
                    {w.name}
                  </Link>
                </td>
                <td className="numeric">{w.datasetCount}</td>
                <td className="numeric">{w.analysisCount}</td>
                <td>{new Date(w.updatedAt).toLocaleString('de-CH')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
export function WorkspaceDetails() {
  const {session, state} = useWorkspace();
  const doc = useStore(state.store, (s) => s.document);
  const [name, setName] = useState(doc.workspace.name);
  const navigate = useNavigate();
  const create = (kind: 'sql' | 'r') => {
    try {
      const id = session.createAnalysis(kind);
      void navigate({
        to:
          kind === 'sql'
            ? '/workspaces/$workspaceId/sql/$analysisId'
            : '/workspaces/$workspaceId/r/$analysisId',
        params: {workspaceId: doc.workspace.id, analysisId: id},
      }).catch(report);
    } catch (error) {
      report(error);
    }
  };
  return (
    <div className="project-details">
      <h1>{doc.workspace.name}</h1>
      <div className="form-fields">
        <FormField label={<>Projektname</>}>
          <Input
            value={name}
            disabled={session.readOnly}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== doc.workspace.name)
                try {
                  session.rename(name);
                } catch (error) {
                  report(error);
                }
            }}
          />
        </FormField>
        <FormField label="Beschreibung">
          <Textarea
            id="workspace-description"
            value={doc.workspace.description ?? ''}
            disabled={session.readOnly}
            maxLength={4000}
            onChange={(e) => {
              try {
                session.describe(e.target.value);
              } catch (error) {
                report(error);
              }
            }}
          />
        </FormField>
      </div>
      <ActionGroup>
        <Button
          icon="floppy"
          disabled={session.readOnly}
          onClick={() => {
            void session.flush().catch(report);
          }}
        >
          Speichern
        </Button>
      </ActionGroup>
      <ArchiveActions session={session} />
      <Diagnostics session={session} />
      <DataSection />
      <section>
        <PanelHeader title="Analysen">
          <ActionGroup>
            <Button disabled={session.readOnly} onClick={() => create('sql')}>
              Neue SQL-Abfrage
            </Button>
            <Button disabled={session.readOnly} onClick={() => create('r')}>
              Neues R-Skript
            </Button>
          </ActionGroup>
        </PanelHeader>
        <ul className="analysis-list">
          {Object.values(doc.analyses)
            .filter((a) => !a.archivedAt)
            .map((a) => (
              <li key={a.id}>
                <Link
                  to={
                    a.kind === 'sql'
                      ? '/workspaces/$workspaceId/sql/$analysisId'
                      : '/workspaces/$workspaceId/r/$analysisId'
                  }
                  params={{workspaceId: doc.workspace.id, analysisId: a.id}}
                >
                  {a.name}
                </Link>
                <StatusBadge>{a.kind.toUpperCase()}</StatusBadge>
                <ActionGroup>
                  <Button
                    disabled={session.readOnly}
                    onClick={() => {
                      try {
                        session.duplicateAnalysis(a.id);
                      } catch (e) {
                        report(e);
                      }
                    }}
                  >
                    Duplizieren
                  </Button>
                  <Button
                    disabled={session.readOnly}
                    onClick={() => {
                      try {
                        session.archiveAnalysis(a.id);
                      } catch (e) {
                        report(e);
                      }
                    }}
                  >
                    Archivieren
                  </Button>
                </ActionGroup>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
