import {Button, Input, Select, FormField, ActionGroup, Toolbar, Notice} from '../../ui/Controls';
import {ActionMenu} from '../../ui/ActionMenu';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels';
import type {RAnalysis, RunId, DatasetId, PlotResult} from '../../domain/model';
import type {EditingSession} from '../../application/workspaceService';
import type {RObjectRef, TransferPlan} from '../../application/ports';
import type {CodeModels} from '../../infrastructure/monaco/models';
import type {Settings} from '../../infrastructure/storage/settings';
import {CodeEditor} from '../../ui/CodeEditor';
import {Modal} from '../../ui/Modal';
import {Parameters} from '../sql/SqlWorkbench';
import {PlanView} from './Transfer';
import {report} from '../../app/router';
import {downloadStream} from '../../app/download';
import {PreviewTable} from '../data/DataSection';
import {useWorkspace} from '../../app/router';
import {useStore} from 'zustand';
import type {ImperativePanelGroupHandle} from 'react-resizable-panels';
export function RWorkbench({
  session,
  analysis,
  models,
  settings,
}: {
  session: EditingSession;
  analysis: RAnalysis;
  models: CodeModels;
  settings: Settings;
}) {
  const service = session.getR();
  useSyncExternalStore(service.subscribe, service.getSnapshot);
  useSyncExternalStore(session.persistence.subscribe, () => session.persistence.document);
  const busy = useSyncExternalStore(session.scheduler.subscribe, session.scheduler.getSnapshot);
  const started = useRef(false);
  const [name, setName] = useState(analysis.name);
  const [selected, setSelected] = useState('latest');
  const {view} = useWorkspace();
  const layout = useStore(view.store, (s) => s.value);
  const consoleOpen = layout.rConsoleVisible,
    objectsOpen = layout.rObjectsVisible;
  const columns = useRef<ImperativePanelGroupHandle>(null),
    rows = useRef<ImperativePanelGroupHandle>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [reset, setReset] = useState(false);
  const [object, setObject] = useState<RObjectRef>();
  const [plan, setPlan] = useState<TransferPlan>();
  const [approved, setApproved] = useState<string[]>([]);
  const [datasetName, setDatasetName] = useState('vergleich');
  const [sqlName, setSqlName] = useState('vergleich');
  const [replace, setReplace] = useState<string>('new');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof service.previewObject>>>();
  useEffect(() => {
    if (!started.current && !session.readOnly) {
      started.current = true;
      void service.activate(analysis.id).catch(report);
    }
  }, [service, session, analysis.id]);
  const runs = Object.values(session.document.runs)
    .filter((r) => r.snapshot.analysisId === analysis.id)
    .reverse()
    .slice(0, 100);
  const run = selected === 'latest' ? runs[0] : runs.find((r) => r.id === selected);
  const plots =
    run?.resultIds
      .map((id) => session.document.results[id])
      .filter((r): r is PlotResult => r?.kind === 'plot') ?? [];
  const execute = (selection?: string) => {
    if (busy || session.readOnly) return;
    setSelected('latest');
    setPreview(undefined);
    void service.run(analysis.id, selection).catch(report);
  };
  return (
    <div className="analysis-area r-workbench">
      <Toolbar className="analysis-toolbar">
        <FormField
          label={
            <>
              <span className="visually-hidden">Analysename</span>
            </>
          }
          labelHidden
        >
          <Input
            value={name}
            disabled={session.readOnly}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              try {
                if (name !== analysis.name) session.updateAnalysis(analysis.id, {name});
              } catch (e) {
                report(e);
              }
            }}
          />
        </FormField>
        <ActionGroup>
          <Button
            variant="primary"
            icon="play-fill"
            busy={busy?.startsWith('R ') ?? false}
            disabled={!!busy || session.readOnly}
            onClick={() => execute()}
          >
            Ausführen
          </Button>
          {busy?.startsWith('R ') && (
            <Button icon="stop-fill" onClick={() => service.cancel()}>
              Abbrechen
            </Button>
          )}
          <Button
            icon="floppy"
            disabled={session.readOnly}
            onClick={() => void session.flush().catch(report)}
          >
            Speichern
          </Button>
        </ActionGroup>
        <ActionGroup>
          <Button
            aria-pressed={objectsOpen}
            onClick={() => view.patch({rObjectsVisible: !objectsOpen})}
          >
            Objekte / Eingaben
          </Button>
          <Button
            aria-pressed={consoleOpen}
            onClick={() => view.patch({rConsoleVisible: !consoleOpen})}
          >
            Konsole
          </Button>
        </ActionGroup>
        <ActionMenu
          actions={[
            {label: 'R-Optionen', onSelect: () => setOptionsOpen(true)},
            {
              label: 'R zurücksetzen',
              disabled: !!busy || session.readOnly,
              variant: 'danger',
              onSelect: () => setReset(true),
            },
            {
              label: 'Arbeitsfläche zurücksetzen',
              icon: 'arrow-repeat',
              onSelect: () => {
                view.reset();
                columns.current?.setLayout([50, 50]);
                rows.current?.setLayout([75, 25]);
              },
            },
          ]}
        />
        {optionsOpen && (
          <Modal title="R-Optionen" onClose={() => setOptionsOpen(false)}>
            <FormField label={<>Umgebung</>}>
              <Select
                value={analysis.environmentMode}
                disabled={!!busy || session.readOnly}
                onChange={(e) =>
                  session.updateAnalysis(analysis.id, {
                    environmentMode: e.target.value as RAnalysis['environmentMode'],
                  })
                }
              >
                <option value="workspace-session">Workspace-Sitzung</option>
                <option value="fresh-environment">Frisches Environment</option>
              </Select>
            </FormField>
            <FormField label={<>Zufallsseed</>}>
              <Input
                type="number"
                disabled={!!busy || session.readOnly}
                min="0"
                max="2147483647"
                defaultValue={analysis.randomSeed ?? ''}
                onBlur={(e) => {
                  try {
                    session.updateAnalysis(analysis.id, {
                      randomSeed: e.target.value === '' ? null : Number(e.target.value),
                    });
                  } catch (error) {
                    report(error);
                  }
                }}
              />
            </FormField>
            <p>Ein frisches Environment ist keine Prozessisolation.</p>
          </Modal>
        )}
      </Toolbar>
      <div className="run-status dw-compact">
        <Parameters analysis={analysis} session={session} />
        <FormField label={<>R-Lauf</>}>
          <Select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setPreview(undefined);
              const id = e.target.value === 'latest' ? runs[0]?.id : (e.target.value as RunId);
              if (id) void service.selectRun(id).catch(report);
            }}
          >
            <option value="latest">Letzter Lauf</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.queuedAt} · {r.status}
              </option>
            ))}
          </Select>
        </FormField>
        <span>
          {busy ?? run?.status ?? 'Bereit'} · R-Epoche {service.epoch}
        </span>
        {!service.scope && !busy && !session.readOnly && (
          <Button onClick={() => void service.activate(analysis.id).catch(report)}>
            R initialisieren
          </Button>
        )}
        {run && (
          <details>
            <summary>Laufdetails</summary>
            <pre>{JSON.stringify(run.snapshot, null, 2)}</pre>
          </details>
        )}
      </div>
      {run?.error && (
        <Notice tone="danger" className="result-error">
          {run.error.code}: {run.error.message}
        </Notice>
      )}
      {run?.warnings.map((w) => (
        <Notice key={w} tone="info">
          {w}
        </Notice>
      ))}
      <PanelGroup
        ref={rows}
        direction="vertical"
        className="r-panels"
        onLayout={(sizes) => {
          if (sizes.length === 2 && sizes[1] !== undefined)
            view.patch({rConsoleFraction: Math.min(0.6, Math.max(0.12, sizes[1] / 100))});
        }}
      >
        <Panel
          id="r-main"
          order={1}
          defaultSize={consoleOpen ? (1 - layout.rConsoleFraction) * 100 : 100}
          minSize={40}
        >
          <div className="r-upper">
            {objectsOpen && (
              <aside className="r-objects">
                <h3>Objekte</h3>
                <small>Scope {service.scope?.key ?? 'nicht aktiv'}</small>
                <ActionGroup>
                  {service.objectList.map((o) => (
                    <Button
                      key={o.ref.name}
                      disabled={!!busy || !o.isDataFrame}
                      onClick={() => {
                        setObject(o.ref);
                        setPlan(undefined);
                        setDatasetName(o.ref.name);
                        setSqlName(o.ref.name.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
                        void service
                          .previewObject(o.ref, new AbortController().signal)
                          .then(setPreview)
                          .catch(report);
                      }}
                    >
                      {o.ref.name} ·{' '}
                      {o.isDataFrame ? `${o.rowCount} × ${o.columnCount}` : o.classes.join(', ')}
                    </Button>
                  ))}
                </ActionGroup>
                <h3>Eingaben</h3>
                {analysis.inputs.map((i) => (
                  <p key={i.name}>
                    <code>{i.name}</code> · {i.source.kind}
                  </p>
                ))}
                {object && (
                  <Button
                    disabled={!!busy || session.readOnly}
                    onClick={() => {
                      setApproved([]);
                      void service
                        .planFromR(object, new AbortController().signal)
                        .then(setPlan)
                        .catch(report);
                    }}
                  >
                    Objekt als Datensatz
                  </Button>
                )}
              </aside>
            )}
            {
              <PanelGroup
                ref={columns}
                direction="horizontal"
                onLayout={(sizes) => {
                  if (sizes[0] !== undefined) view.patch({rEditorFraction: sizes[0] / 100});
                }}
              >
                <Panel defaultSize={layout.rEditorFraction * 100} minSize={25}>
                  <CodeEditor
                    models={models}
                    id={analysis.id}
                    kind="r"
                    code={analysis.code}
                    readOnly={session.readOnly}
                    onChange={(code) => session.updateAnalysis(analysis.id, {code})}
                    onSave={() => void session.flush().catch(report)}
                    onRun={execute}
                    fontSize={settings.editorFontSize}
                    wordWrap={settings.wordWrap}
                    lineNumbers={settings.showLineNumbers}
                  />
                </Panel>
                <PanelResizeHandle
                  className="panel-handle horizontal-handle"
                  aria-label="R Editor und Ausgabe teilen"
                />
                <Panel minSize={25}>
                  <div className="r-output">
                    {preview ? (
                      <>
                        <Button onClick={() => setPreview(undefined)}>Grafiken anzeigen</Button>
                        <PreviewTable preview={preview} />
                      </>
                    ) : plots.length ? (
                      plots.map((plot) => <Plot key={plot.id} session={session} result={plot} />)
                    ) : (
                      <p>
                        Grafiken erscheinen nach einem erfolgreichen Lauf. Dataframes sind über die
                        Objektliste erreichbar.
                      </p>
                    )}
                  </div>
                </Panel>
              </PanelGroup>
            }
          </div>
        </Panel>
        {consoleOpen && (
          <>
            <PanelResizeHandle className="panel-handle" aria-label="R Konsole teilen" />
            <Panel
              id="r-console"
              order={2}
              defaultSize={layout.rConsoleFraction * 100}
              minSize={12}
            >
              <div className="r-console" role="log" aria-label="R-Konsole">
                {run ? (
                  service.console(run.id).map((line, i) => (
                    <pre key={i} data-kind={line.kind}>
                      <strong>{line.kind}</strong> {line.text}
                    </pre>
                  ))
                ) : (
                  <p>
                    Ausgabe, Meldungen und Warnungen. print()/cat() für explizite Ausgabe verwenden.
                  </p>
                )}
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
      {reset && (
        <Modal
          title="R-Sitzung zurücksetzen?"
          onClose={() => setReset(false)}
          footer={
            <>
              <Button
                variant="danger"
                onClick={() => {
                  void service
                    .reset()
                    .then(() => {
                      setReset(false);
                      setPreview(undefined);
                      setObject(undefined);
                    })
                    .catch(report);
                }}
              >
                Reset bestätigen
              </Button>
            </>
          }
        >
          <p>
            {service.objectList.length} ungesicherte Objekte werden verworfen. Gespeicherter Code,
            Daten und SQL-Resultate bleiben erhalten.
          </p>
        </Modal>
      )}
      {plan && (
        <Modal
          title="R-Objekt nach SQL übernehmen"
          onClose={() => setPlan(undefined)}
          footer={
            <>
              <Button
                variant="primary"
                disabled={
                  !!busy || plan.issues.some((i) => i.requiresApproval && !approved.includes(i.id))
                }
                onClick={() =>
                  void service
                    .commitFromR(plan.id, datasetName, approved, new AbortController().signal, {
                      sqlName,
                      ...(replace === 'new' ? {} : {replace: replace as DatasetId}),
                    })
                    .then(() => setPlan(undefined))
                    .catch(report)
                }
              >
                Datensatz übernehmen
              </Button>
            </>
          }
        >
          <PlanView plan={plan} approved={approved} onChange={setApproved} />
          <FormField label={<>Datensatzname</>}>
            <Input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />
          </FormField>
          <FormField label={<>Zieldatensatz</>}>
            <Select value={replace} onChange={(e) => setReplace(e.target.value)}>
              <option value="new">Neuer Datensatz</option>
              {Object.values(session.document.datasets)
                .filter((d) => !d.removedAt)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ersetzen
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label={<>SQL-Name</>}>
            <Input
              value={sqlName}
              disabled={replace !== 'new'}
              onChange={(e) => setSqlName(e.target.value)}
            />
          </FormField>
        </Modal>
      )}
    </div>
  );
}
function Plot({session, result}: {session: EditingSession; result: PlotResult}) {
  const [url, setUrl] = useState('');
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let objectUrl = '';
    void session
      .getR()
      .plot(result.id, new AbortController().signal)
      .then((blob) => {
        if (live) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(report);
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, result.id]);
  return (
    <div ref={container} className="r-plot">
      {url && <img src={url} alt={result.name} />}
      <ActionGroup className="dw-compact">
        <Button
          icon="arrows-fullscreen"
          onClick={() => void container.current?.requestFullscreen().catch(report)}
        >
          Grafik Vollbild
        </Button>
        <Button
          onClick={() =>
            void session
              .getR()
              .plot(result.id, new AbortController().signal)
              .then((blob) => downloadStream(blob.stream(), 'r-grafik.png', 'image/png'))
              .catch(report)
          }
        >
          PNG herunterladen
        </Button>
        <Button
          disabled={session.readOnly || result.retention === 'kept'}
          onClick={() => void session.getR().keepPlot(result.id).catch(report)}
        >
          Grafik aufbewahren
        </Button>
      </ActionGroup>
    </div>
  );
}
