import {StorageSettings} from '../features/workspaces/StorageSettings';
import {WorkspaceViewController} from '../state/workspaceView';
import {failureMessage} from '../application/errors';
import {RWorkbench} from '../features/r/RWorkbench';
import {PortalOpen} from '../features/catalog/PortalImport';
import {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  Link,
  redirect,
  useBlocker,
  useRouterState,
  useRouter,
} from '@tanstack/react-router';
import {useStore} from 'zustand';
import logo from '../assets/kanton-solothurn.svg';
import {services} from './services';
import {appStore} from '../state/appStore';
import {createWorkspaceStore} from '../state/workspaceStore';
import {CodeModels} from '../infrastructure/monaco/models';
import type {EditingSession} from '../application/workspaceService';
import type {AnalysisId} from '../domain/model';
import {checkedId} from '../domain/workspace';
import {SqlWorkbench} from '../features/sql/SqlWorkbench';
import {WorkspaceList, WorkspaceDetails} from '../features/workspaces/Workspaces';
function message(error: unknown) {
  return failureMessage(error);
}
export function report(error: unknown) {
  appStore.setState({error: message(error)});
}
const rootRoute = createRootRoute({
  component: Shell,
  errorComponent: ({error}) => (
    <div role="alert">
      <h1>Projekt konnte nicht geöffnet werden</h1>
      <p>{message(error)}</p>
      <Link to="/workspaces">Arbeitsbereiche</Link>
    </div>
  ),
  notFoundComponent: () => (
    <main>
      <h1>Nicht gefunden</h1>
      <Link to="/workspaces">Arbeitsbereiche</Link>
    </main>
  ),
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({to: '/workspaces'});
  },
});
export const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces',
  loader: async () => {
    await services.workspaces.close();
    return services.workspaces.list();
  },
  component: WorkspaceList,
});
export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces/$workspaceId',
  loader: ({params}) => services.workspaces.open(params.workspaceId),
  component: WorkspaceProvider,
});
const detailRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  component: WorkspaceDetails,
});
const dataRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'data',
  component: WorkspaceDetails,
});
const sqlRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'sql/$analysisId',
  component: () => <AnalysisPage kind="sql" analysisId={sqlRoute.useParams().analysisId} />,
});
const rRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'r/$analysisId',
  component: () => <AnalysisPage kind="r" analysisId={rRoute.useParams().analysisId} />,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  loader: async () => {
    await services.workspaces.close();
  },
  component: SettingsPage,
});
const openRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/open',
  loader: () => services.workspaces.close(),
  component: PortalOpen,
});
export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    openRoute,
    listRoute,
    workspaceRoute.addChildren([detailRoute, dataRoute, sqlRoute, rRoute]),
    settingsRoute,
  ]),
  basepath: import.meta.env.BASE_URL,
  defaultPreload: false,
  defaultPendingMs: 0,
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
function Shell() {
  const error = useStore(appStore, (s) => s.error);
  useEffect(() => {
    void services.settings
      .load()
      .then((settings) => appStore.setState({settings}))
      .catch(report);
  }, []);
  return (
    <>
      <header>
        <img src={logo} alt="Kanton Solothurn" />
        <Link to="/workspaces" className="brand">
          Datenwerkstatt
        </Link>
        <span className="build-status">
          {services.mode === 'temporary'
            ? 'Nur diese Sitzung · Verlust bei Reload'
            : 'Entwicklungsstand · nicht abgenommen'}
        </span>
        <Link to="/settings">Einstellungen</Link>
      </header>
      {error && (
        <div role="alert" className="error">
          <strong>{error}</strong>
          <button onClick={() => appStore.setState({error: null})}>Hinweis schliessen</button>
        </div>
      )}
      <Outlet />
    </>
  );
}
interface Context {
  session: EditingSession;
  state: ReturnType<typeof createWorkspaceStore>;
  models: CodeModels;
  view: WorkspaceViewController;
}
const workspaceContext = createContext<Context | null>(null);
export function useWorkspace() {
  const ctx = useContext(workspaceContext);
  if (!ctx) throw Error('Workspace fehlt.');
  return ctx;
}
function WorkspaceProvider() {
  const session = workspaceRoute.useLoaderData();
  const ctx = useMemo(
    () => ({
      session,
      state: createWorkspaceStore(session),
      models: new CodeModels(session.sessionId),
      view: new WorkspaceViewController(
        services.views,
        session.document.workspace.id,
        report,
        appStore.getState().settings.sidebarCollapsed,
      ),
    }),
    [session],
  );
  useEffect(() => {
    const unsubscribe = ctx.state.connect();
    void ctx.view.load();
    return () => {
      unsubscribe();
      ctx.models.dispose();
      void ctx.view.flush();
    };
  }, [ctx]);
  const state = useStore(ctx.state.store, (s) => s.saveState);
  const error = useStore(ctx.state.store, (s) => s.error);
  const path = useRouterState({select: (s) => s.location.pathname});
  const view = useStore(ctx.view.store, (s) => s.value);
  const expanded = !view.sidebarCollapsed;
  const openAnalysis = (kind: 'sql' | 'r') => {
    const ids = [view.activeAnalysisId, ...view.openAnalysisIds.slice().reverse()];
    const saved = ids.find(
      (id) =>
        id &&
        session.document.analyses[id]?.kind === kind &&
        !session.document.analyses[id]?.archivedAt,
    );
    if (!saved && session.readOnly) return;
    const id = saved ?? session.createAnalysis(kind);
    void routerApi
      .navigate({
        to:
          kind === 'sql'
            ? '/workspaces/$workspaceId/sql/$analysisId'
            : '/workspaces/$workspaceId/r/$analysisId',
        params: {workspaceId: session.document.workspace.id, analysisId: id},
      })
      .catch(report);
  };
  const routerApi = useRouter();
  useBlocker({
    enableBeforeUnload: () =>
      session.persistence.generation !== session.persistence.savedGeneration,
    shouldBlockFn: async ({next}) => {
      if (next.pathname.startsWith(`/workspaces/${session.document.workspace.id}`)) return false;
      try {
        await session.flush();
        return false;
      } catch (error) {
        report(error);
        return true;
      }
    },
  });
  return (
    <workspaceContext.Provider value={ctx}>
      <div className="workspace-layout">
        <nav className={expanded ? 'sidebar expanded' : 'sidebar'} aria-label="Arbeitsbereich">
          <button
            aria-label={expanded ? 'Navigation einklappen' : 'Navigation ausklappen'}
            title="Navigation umschalten"
            onClick={() => ctx.view.patch({sidebarCollapsed: expanded})}
          >
            ☰
          </button>
          <Link to="/workspaces" title="Arbeitsbereiche" aria-label="Arbeitsbereiche">
            ▤{expanded && ' Arbeitsbereiche'}
          </Link>
          <Link
            to="/workspaces/$workspaceId"
            params={{workspaceId: session.document.workspace.id}}
            title="Projektübersicht"
            aria-label="Projektübersicht"
          >
            ⌂{expanded && ' Projektübersicht'}
          </Link>
          <Link
            to="/workspaces/$workspaceId/data"
            params={{workspaceId: session.document.workspace.id}}
            title="Daten"
            aria-label="Daten"
          >
            ▦{expanded && ' Daten'}
          </Link>
          <button title="SQL" aria-label="SQL" onClick={() => openAnalysis('sql')}>
            SQL
          </button>
          <button title="R" aria-label="R" onClick={() => openAnalysis('r')}>
            R
          </button>
        </nav>
        <section className="workspace-content" data-analysis={/\/(sql|r)\//.test(path)}>
          <div className="save-status" aria-live="polite">
            {session.readOnly
              ? 'Nur lesend · Schreibrecht liegt in einem anderen Tab oder Web Locks fehlen.'
              : state === 'saved'
                ? session.mode === 'temporary'
                  ? 'Nur diese Sitzung · kein Backup'
                  : 'Lokal gespeichert · kein Backup'
                : state === 'saving'
                  ? 'Speichert …'
                  : state === 'error'
                    ? 'Speichern fehlgeschlagen'
                    : 'Nicht gespeichert'}
            {session.readOnly && (
              <button
                onClick={() => {
                  void services.workspaces
                    .reacquire(session.document.workspace.id)
                    .then(() => routerApi.invalidate())
                    .catch(report);
                }}
              >
                Schreibrecht erneut anfordern
              </button>
            )}
          </div>
          {error !== undefined && (
            <div className="error" role="alert">
              {message(error)}{' '}
              <button
                onClick={() => {
                  if (session.persistence.generation === session.persistence.savedGeneration)
                    session.persistence.acknowledgeUnpublishedFailure();
                  else void session.flush().catch(report);
                }}
              >
                {session.persistence.generation === session.persistence.savedGeneration
                  ? 'Vorherigen Projektstand beibehalten'
                  : 'Speichern erneut versuchen'}
              </button>
            </div>
          )}
          <Outlet />
        </section>
      </div>
    </workspaceContext.Provider>
  );
}
function AnalysisPage({kind, analysisId}: {kind: 'sql' | 'r'; analysisId: string}) {
  const {session, state, models, view} = useWorkspace();
  const ready = useStore(view.store, (s) => s.ready);
  useEffect(() => {
    if (!ready || !session.document.analyses[analysisId as AnalysisId]) return;
    const id = analysisId as AnalysisId,
      current = view.store.getState().value;
    view.patch({
      activeAnalysisId: id,
      openAnalysisIds: [...current.openAnalysisIds.filter((x) => x !== id), id],
      ...(current.openAnalysisIds.length ? {} : {sidebarCollapsed: true}),
    });
  }, [analysisId, ready, session, view]);
  const doc = useStore(state.store, (s) => s.document);
  let id;
  try {
    id = checkedId<'analysis'>(analysisId);
  } catch {
    return <h1>Analyse nicht gefunden</h1>;
  }
  const analysis = doc.analyses[id];
  if (!analysis || analysis.kind !== kind || analysis.archivedAt)
    return <h1>Analyse nicht gefunden</h1>;
  if (!ready) return <p role="status">Arbeitsfläche wird geladen …</p>;
  return <AnalysisEditor key={id} analysisId={id} models={models} session={session} />;
}
function AnalysisEditor({
  analysisId,
  models,
  session,
}: {
  analysisId: AnalysisId;
  models: CodeModels;
  session: EditingSession;
}) {
  const {state} = useWorkspace();
  const analysis = useStore(state.store, (s) => s.document.analyses[analysisId])!;
  const settings = useStore(appStore, (s) => s.settings);
  return analysis.kind === 'sql' ? (
    <SqlWorkbench session={session} analysis={analysis} models={models} settings={settings} />
  ) : (
    <RWorkbench session={session} analysis={analysis} models={models} settings={settings} />
  );
}

function SettingsPage() {
  const settings = useStore(appStore, (s) => s.settings);
  const [saveState, setSaveState] = useState('Einstellungen gespeichert');
  const save = (next: typeof settings) => {
    appStore.setState({settings: next});
    setSaveState('Einstellungen werden gespeichert …');
    void services.settings
      .save(next)
      .then(() => {
        if (appStore.getState().settings === next) setSaveState('Einstellungen gespeichert');
      })
      .catch((error) => {
        setSaveState('Speichern fehlgeschlagen');
        report(error);
      });
  };
  return (
    <main>
      <h1>Einstellungen</h1>
      <div className="form-fields">
        <label>
          Editor-Schriftgrösse
          <select
            value={settings.editorFontSize}
            onChange={(e) => save({...settings, editorFontSize: Number(e.target.value)})}
          >
            {Array.from({length: 11}, (_, i) => i + 12).map((n) => (
              <option key={n} value={n}>
                {n} px
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.showLineNumbers}
            onChange={(e) => save({...settings, showLineNumbers: e.target.checked})}
          />
          Zeilennummern
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.wordWrap}
            onChange={(e) => save({...settings, wordWrap: e.target.checked})}
          />
          Zeilenumbruch
        </label>
      </div>
      <p role="status">{saveState}</p>
      <label>
        <input
          type="checkbox"
          checked={settings.sidebarCollapsed}
          onChange={(e) => save({...settings, sidebarCollapsed: e.target.checked})}
        />
        Seitenleiste standardmässig eingeklappt
      </label>
      <StorageSettings />
    </main>
  );
}
