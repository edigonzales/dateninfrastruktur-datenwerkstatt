import {numericColumn} from '../../ui/table';
import {Button, Input, Select, FormField, ActionGroup, Toolbar, Notice} from '../../ui/Controls';
import {ActionMenu} from '../../ui/ActionMenu';
import {Modal} from '../../ui/Modal';
import {failureMessage} from '../../application/errors';
import {TransferToR} from '../r/Transfer';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels';
import type {
  Analysis,
  ExecutionRun,
  ParameterValue,
  SqlAnalysis,
  TableResult,
  Visualization,
} from '../../domain/model';
import type {EditingSession} from '../../application/workspaceService';
import type {CodeModels} from '../../infrastructure/monaco/models';
import type {Settings} from '../../infrastructure/storage/settings';
import {CodeEditor} from '../../ui/CodeEditor';
import {downloadStream} from '../../app/download';
import {parameterSchema} from '../../domain/workspace';
import {report, useWorkspace} from '../../app/router';
import {useStore} from 'zustand';
import {usePanelHeight} from '../../ui/PanelLayout';
import type {ImperativePanelGroupHandle} from 'react-resizable-panels';
import {Chart} from './chart';

export function SqlWorkbench({
  session,
  analysis,
  models,
  settings,
}: {
  session: EditingSession;
  analysis: SqlAnalysis;
  models: CodeModels;
  settings: Settings;
}) {
  const service = session.getAnalyses();
  const {view} = useWorkspace();
  const layout = useStore(view.store, (s) => s.value);
  const panels = useRef<ImperativePanelGroupHandle>(null);
  const {ref: panelHost, height: panelHeight} = usePanelHeight();
  useSyncExternalStore(session.persistence.subscribe, () => session.persistence.document);
  const busy = useSyncExternalStore(session.scheduler.subscribe, session.scheduler.getSnapshot);
  const [name, setName] = useState(analysis.name);
  const [selected, setSelected] = useState<string>('latest');
  const runs = Object.values(session.document.runs)
    .filter((r) => r.snapshot.analysisId === analysis.id)
    .reverse()
    .slice(0, 100);
  const run = selected === 'latest' ? runs[0] : runs.find((r) => r.id === selected);
  const result = run?.resultIds[0] ? session.document.results[run.resultIds[0]] : undefined;
  const execute = (selection?: string) => {
    if (!busy && !session.readOnly) {
      setSelected('latest');
      void service.run(analysis.id, selection).catch(report);
    }
  };
  return (
    <div className="analysis-area">
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
            busy={busy?.startsWith('SQL ') ?? false}
            disabled={session.readOnly || !!busy}
            onClick={() => execute()}
          >
            Ausführen
          </Button>
          {busy === 'SQL ausführen' && (
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
        <Button
          aria-pressed={layout.dataPanelVisible}
          onClick={() => view.patch({dataPanelVisible: !layout.dataPanelVisible})}
        >
          Schema
        </Button>
        <span role="status" aria-live={busy ? 'polite' : 'off'}>
          {busy ?? `SQL · Revision ${analysis.revision}`}
        </span>
        <ActionMenu
          actions={[
            {
              label: 'Arbeitsfläche zurücksetzen',
              icon: 'arrow-repeat',
              onSelect: () => {
                view.reset();
                panels.current?.setLayout([45, 55]);
              },
            },
          ]}
        />
      </Toolbar>
      <Parameters key={analysis.id} analysis={analysis} session={session} />
      {layout.dataPanelVisible && (
        <Modal
          title="Datenschema"
          className="schema-drawer"
          onClose={() => view.patch({dataPanelVisible: false})}
          showClose={false}
        >
          <Button onClick={() => view.patch({dataPanelVisible: false})}>Schema schliessen</Button>
          {Object.values(session.document.datasets)
            .filter((d) => !d.removedAt)
            .map((d) => (
              <details key={d.id}>
                <summary>{d.sqlName}</summary>
                {session.document.datasetVersions[d.currentVersionId]!.schema.columns.map((c) => (
                  <p key={c.name}>
                    {c.name} · {c.logicalType}
                  </p>
                ))}
              </details>
            ))}
        </Modal>
      )}
      <div className="sql-panel-host" ref={panelHost}>
        <PanelGroup
          ref={panels}
          direction="vertical"
          className="sql-panels"
          onLayout={(sizes) => {
            if (sizes[0] !== undefined)
              view.patch({sqlEditorFraction: Math.min(0.8, Math.max(0.15, sizes[0] / 100))});
          }}
        >
          <Panel
            defaultSize={layout.sqlEditorFraction * 100}
            minSize={Math.min(45, (180 / panelHeight) * 100)}
          >
            <CodeEditor
              models={models}
              id={analysis.id}
              kind="sql"
              code={analysis.code}
              readOnly={session.readOnly}
              onChange={(code) => {
                try {
                  session.updateAnalysis(analysis.id, {code});
                } catch (e) {
                  report(e);
                }
              }}
              onSave={() => {
                void session.flush().catch(report);
              }}
              onRun={execute}
              fontSize={settings.editorFontSize}
              wordWrap={settings.wordWrap}
              lineNumbers={settings.showLineNumbers}
            />
          </Panel>
          <PanelResizeHandle
            className="panel-handle"
            aria-label="Grösse von Editor und Resultat ändern"
          />
          <Panel minSize={Math.min(50, (220 / panelHeight) * 100)}>
            <section className="result-section" aria-label="SQL-Resultat">
              <Toolbar className="result-toolbar">
                <FormField label={<>Lauf</>}>
                  <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
                    <option value="latest">Letzter Lauf</option>
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.queuedAt} · Revision {r.snapshot.analysisRevision} · {statusText(r)}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {run && (
                  <span>
                    {statusText(run)} · Revision {run.snapshot.analysisRevision} ·{' '}
                    {run.durationMs ?? '–'} ms
                  </span>
                )}
              </Toolbar>
              {run?.error && (
                <Notice tone="danger" className="result-error">
                  {run.error.code}: {run.error.message}
                </Notice>
              )}
              {!run && (
                <p className="result-empty">
                  Ausführen oder ⌘/Strg + Enter startet einen neuen Lauf.
                </p>
              )}
              {run?.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              {result?.kind === 'table' && (
                <TableView key={result.id} result={result} session={session} />
              )}
              {run && (
                <details className="run-details">
                  <summary>Laufdetails und eingefrorener Code</summary>
                  <p>
                    Lauf {run.id} · {run.snapshot.runtime.engineVersion} · UTC
                  </p>
                  <p>{run.snapshot.notes.join(' ')}</p>
                  <pre>{run.snapshot.code}</pre>
                  <pre>{JSON.stringify(run.snapshot.parameters, null, 2)}</pre>
                  <pre>{JSON.stringify(run.snapshot.resolvedInputs, null, 2)}</pre>
                  <details>
                    <summary>Intern ausgeführter Wrapper</summary>
                    <pre>{run.executedCode}</pre>
                  </details>
                </details>
              )}
            </section>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
function statusText(r: ExecutionRun) {
  return {
    queued: 'Wartet',
    running: 'Läuft',
    cancelling: 'Wird beendet',
    succeeded: 'Erfolgreich',
    failed: 'Fehlgeschlagen',
    cancelled: 'Abgebrochen',
    interrupted: 'Unterbrochen',
  }[r.status];
}
type ParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'int64'
  | 'decimal'
  | 'date'
  | 'timestamp';
function parameterRows(parameters: Analysis['parameters']) {
  return Object.entries(parameters).map(([name, value]) => ({
    name,
    type: (value === null
      ? 'null'
      : typeof value === 'object'
        ? value.type
        : typeof value) as ParameterType,
    value: value === null ? '' : typeof value === 'object' ? value.value : String(value),
  }));
}
export function Parameters({analysis, session}: {analysis: Analysis; session: EditingSession}) {
  const [rows, setRows] = useState(() => parameterRows(analysis.parameters));
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  return (
    <details className="parameters dw-compact">
      <summary>
        Parameter ({Object.keys(analysis.parameters).length})
        {dirty ? ' · Änderungen noch nicht übernommen' : ''}
      </summary>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Typ</th>
            <th>Wert</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <Input
                  aria-label={`Parameter ${i + 1} Name`}
                  disabled={session.readOnly}
                  value={row.name}
                  onChange={(e) => {
                    setDirty(true);
                    setRows(rows.map((r, j) => (j === i ? {...r, name: e.target.value} : r)));
                  }}
                />
              </td>
              <td>
                <Select
                  aria-label={`Parameter ${i + 1} Typ`}
                  disabled={session.readOnly}
                  value={row.type}
                  onChange={(e) => {
                    setDirty(true);
                    setRows(
                      rows.map((r, j) =>
                        j === i ? {...r, type: e.target.value as ParameterType} : r,
                      ),
                    );
                  }}
                >
                  {[
                    'string',
                    'number',
                    'boolean',
                    'null',
                    'int64',
                    'decimal',
                    'date',
                    'timestamp',
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </td>
              <td>
                <Input
                  aria-label={`Parameter ${i + 1} Wert`}
                  disabled={session.readOnly || row.type === 'null'}
                  value={row.value}
                  onChange={(e) => {
                    setDirty(true);
                    setRows(rows.map((r, j) => (j === i ? {...r, value: e.target.value} : r)));
                  }}
                />
              </td>
              <td>
                <Button
                  disabled={session.readOnly}
                  aria-label={`Parameter ${i + 1} entfernen`}
                  onClick={() => {
                    setDirty(true);
                    setRows(rows.filter((_, j) => i !== j));
                  }}
                >
                  Entfernen
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ActionGroup>
        <Button
          disabled={session.readOnly}
          onClick={() => {
            setRows([...rows, {name: '', type: 'string', value: ''}]);
            setDirty(true);
          }}
        >
          Parameter hinzufügen
        </Button>
        <Button
          disabled={session.readOnly || !dirty}
          onClick={() => {
            try {
              const parameters: Record<string, ParameterValue> = {};
              for (const row of rows) {
                if (
                  !/^[A-Za-z][A-Za-z0-9_]*$/.test(row.name) ||
                  Object.hasOwn(parameters, row.name)
                )
                  throw Error('Parameternamen müssen eindeutig und gültig sein.');
                if (row.type === 'boolean' && !['true', 'false'].includes(row.value))
                  throw Error('Boolescher Wert: true oder false.');
                if (row.type === 'number' && !row.value.trim()) throw Error('Zahl fehlt.');
                const value =
                  row.type === 'null'
                    ? null
                    : row.type === 'number'
                      ? Number(row.value)
                      : row.type === 'boolean'
                        ? row.value === 'true'
                        : row.type === 'string'
                          ? row.value
                          : {type: row.type, value: row.value};
                parameters[row.name] = parameterSchema.parse(value);
              }
              session.updateAnalysis(analysis.id, {parameters});
              setDirty(false);
              setError('');
            } catch (e) {
              setError(failureMessage(e));
            }
          }}
        >
          Parameter übernehmen
        </Button>
      </ActionGroup>
      {error && <Notice tone="danger">{error}</Notice>}
    </details>
  );
}
function TableView({result, session}: {result: TableResult; session: EditingSession}) {
  const service = session.getAnalyses();
  const [transfer, setTransfer] = useState(false);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{column: string; direction: 'asc' | 'desc'}[]>([]);
  const [rows, setRows] = useState<readonly (readonly unknown[])[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'table' | 'chart'>('table');
  const [datasetName, setDatasetName] = useState(result.name);
  const [sqlName, setSqlName] = useState('ergebnis');
  const busy = useSyncExternalStore(session.scheduler.subscribe, session.scheduler.getSnapshot);
  // Paging cancellation discards the UI reply only; it must never cancel another engine job.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void service
      .page(result.id, {offset, size: 100, sort}, new AbortController().signal)
      .then(
        (page) => {
          if (current) setRows(page.rows);
        },
        (e) => {
          if (current) {
            setError(failureMessage(e));
            setRows([]);
          }
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [service, result.id, offset, sort]);
  const unavailable = result.materialization.kind === 'unavailable';
  return (
    <>
      <Toolbar className="result-toolbar">
        <strong>
          {result.rowCount} Zeilen ·{' '}
          {result.coverage.kind === 'limited' ? 'begrenzt' : 'vollständig'} ·{' '}
          {result.retention === 'kept' ? 'aufbewahrt' : 'temporär'}
        </strong>
        <ActionGroup>
          <Button
            disabled={!!busy || unavailable || session.readOnly || result.retention === 'kept'}
            onClick={() => {
              void service.keep(result.id).catch(report);
            }}
          >
            Aufbewahren
          </Button>
          <Button
            disabled={!!busy || unavailable || session.readOnly}
            onClick={() => setTransfer(true)}
          >
            In R
          </Button>
        </ActionGroup>
        {(['csv', 'parquet'] as const).map((format) => (
          <Button
            key={format}
            disabled={!!busy || unavailable}
            onClick={() => {
              void service
                .export(result.id, format, new AbortController().signal)
                .then((stream) =>
                  downloadStream(
                    stream,
                    `${result.name}.${format}`,
                    format === 'csv' ? 'text/csv' : 'application/vnd.apache.parquet',
                  ),
                )
                .catch(report);
            }}
          >
            {format.toUpperCase()} exportieren
          </Button>
        ))}
        <Button
          disabled={unavailable}
          onClick={() => setView(view === 'table' ? 'chart' : 'table')}
        >
          {view === 'table' ? 'Diagramm' : 'Tabelle'}
        </Button>
      </Toolbar>
      {transfer && (
        <TransferToR session={session} resultId={result.id} onClose={() => setTransfer(false)} />
      )}
      {result.coverage.kind === 'limited' && (
        <p className="result-error">
          Das App-Limit hat dieses Resultat gekürzt. Die ursprüngliche Gesamtzahl ist unbekannt.
        </p>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {view === 'table' ? (
        <>
          <div className="result-grid" aria-busy={loading}>
            <table>
              <thead>
                <tr>
                  {result.schema.columns.map((col) => (
                    <th
                      key={col.name}
                      className={numericColumn(col.logicalType) ? 'numeric' : undefined}
                    >
                      <Button
                        onClick={() => {
                          setOffset(0);
                          setSort([
                            {
                              column: col.name,
                              direction:
                                sort[0]?.column === col.name && sort[0].direction === 'asc'
                                  ? 'desc'
                                  : 'asc',
                            },
                          ]);
                        }}
                      >
                        {col.name}
                        {sort[0]?.column === col.name
                          ? sort[0].direction === 'asc'
                            ? ' ↑'
                            : ' ↓'
                          : ''}
                      </Button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={offset + i}>
                    {row.map((value, j) => (
                      <td
                        key={j}
                        className={
                          numericColumn(result.schema.columns[j]?.logicalType)
                            ? 'numeric'
                            : undefined
                        }
                      >
                        {value === null ? (
                          <span className="null-cell">NULL</span>
                        ) : (
                          String(value ?? '')
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Toolbar className="result-toolbar">
            <Button disabled={offset === 0 || loading} onClick={() => setOffset(offset - 100)}>
              Vorherige Seite
            </Button>
            <span>Seite {Math.floor(offset / 100) + 1} · bis zu 100 Zeilen</span>
            <Button
              disabled={offset + 100 >= Number(result.rowCount) || loading}
              onClick={() => setOffset(offset + 100)}
            >
              Nächste Seite
            </Button>
          </Toolbar>
        </>
      ) : (
        <ChartControls result={result} session={session} />
      )}
      <details className="result-data">
        <summary>Als Datensatz übernehmen · Schema</summary>
        <p>
          Das vollständige Resultat wird zuerst aufbewahrt und als neue Dateneinbindung gespeichert.
        </p>
        <FormField label={<>Datensatzname</>}>
          <Input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />
        </FormField>
        <FormField label={<>SQL-Name</>}>
          <Input value={sqlName} onChange={(e) => setSqlName(e.target.value)} />
        </FormField>
        <Button
          disabled={!!busy || session.readOnly || unavailable}
          onClick={() => {
            void service.asDataset(result.id, datasetName, sqlName).catch(report);
          }}
        >
          Als Datensatz speichern
        </Button>
        <table>
          <tbody>
            {result.schema.columns.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.logicalType}</td>
                <td>{c.nullable ? 'NULL möglich' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
function ChartControls({result, session}: {result: TableResult; session: EditingSession}) {
  const service = session.getAnalyses();
  const saved = Object.values(session.document.visualizations).filter(
    (v) => v.tableResultId === result.id,
  );
  const [spec, setSpec] = useState<Visualization['spec']>(
    saved[0]?.spec ?? {
      type: 'bar',
      x: result.schema.columns[0]!.name,
      y: result.schema.columns[1]?.name ?? result.schema.columns[0]!.name,
    },
  );
  const [data, setData] = useState<Awaited<ReturnType<typeof service.chartData>>>();
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  const busy = useSyncExternalStore(session.scheduler.subscribe, session.scheduler.getSnapshot);
  useEffect(() => {
    let current = true;
    setData(undefined);
    setError('');
    void service.chartData(result.id, spec, new AbortController().signal).then(
      (d) => {
        if (current) setData(d);
      },
      (e) => {
        if (current) setError(failureMessage(e));
      },
    );
    return () => {
      current = false;
    };
  }, [service, result.id, spec]);
  return (
    <div className="chart-area">
      <Toolbar className="result-toolbar">
        <FormField label={<>Diagrammtyp</>}>
          <Select
            value={spec.type}
            onChange={(e) =>
              setSpec({...spec, type: e.target.value as Visualization['spec']['type']})
            }
          >
            <option value="bar">Balken</option>
            <option value="line">Linie</option>
            <option value="scatter">Scatter</option>
          </Select>
        </FormField>
        {(['x', 'y', 'color'] as const).map((axis) => (
          <FormField key={axis} label={<>{axis === 'color' ? 'Kategorie' : axis.toUpperCase()}</>}>
            <Select
              aria-label={`Diagramm ${axis}`}
              value={spec[axis] ?? ''}
              onChange={(e) => {
                const next = {...spec};
                if (axis === 'color' && !e.target.value) delete next.color;
                else next[axis] = e.target.value;
                setSpec(next);
              }}
            >
              {axis === 'color' && <option value="">Keine</option>}
              {result.schema.columns.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </Select>
          </FormField>
        ))}
        <ActionGroup>
          <Button
            disabled={!data || !!error || !!busy || session.readOnly}
            onClick={() => {
              void service.saveVisualization(result.id, result.name, spec).catch(report);
            }}
          >
            Diagramm speichern
          </Button>
          <Button
            disabled={!data || !!error}
            onClick={() =>
              canvas.current?.toBlob((blob) => {
                if (blob) void downloadStream(blob.stream(), `${result.name}.png`, 'image/png');
              }, 'image/png')
            }
          >
            PNG exportieren
          </Button>
        </ActionGroup>
        {saved.length > 0 && <span>{saved.length} Diagramm(e) gespeichert</span>}
      </Toolbar>
      {error && <Notice tone="danger">{error}</Notice>}
      {data && (
        <Chart canvas={canvas} data={data} spec={spec} title={result.name} onError={setError} />
      )}
    </div>
  );
}
