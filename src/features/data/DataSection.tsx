import {Modal} from '../../ui/Modal';
import {PortalImport} from '../catalog/PortalImport';
import {useEffect, useRef, useState} from 'react';
import {useStore} from 'zustand';
import {useWorkspace, report} from '../../app/router';
import type {CsvImportOptions, Dataset, DatasetId, TableSchema} from '../../domain/model';
import type {ImportPreview} from '../../application/importPorts';
import {downloadStream} from '../../app/download';
const defaults = (): CsvImportOptions => ({
  encoding: 'utf-8',
  delimiter: ';',
  header: true,
  quote: '"',
  escape: '"',
  decimalSeparator: '.',
  nullStrings: [],
  emptyStringIsNull: true,
  columns: [],
});
const types = [
  'VARCHAR',
  'BOOLEAN',
  'INTEGER',
  'BIGINT',
  'UBIGINT',
  'DOUBLE',
  'DATE',
  'TIMESTAMP',
  'TIMESTAMPTZ',
  'DECIMAL(18,4)',
  'DECIMAL(38,18)',
];
export function PreviewTable({preview}: {preview: Pick<ImportPreview, 'schema' | 'rows'>}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {preview.schema.columns.map((c) => (
              <th key={c.name}>
                {c.name}
                <small>{c.logicalType}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, column) => (
                <td key={column}>
                  {value === null ? <i>NULL</i> : value === '' ? <i>Leerstring</i> : String(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function DataSection() {
  const {session, state} = useWorkspace();
  const doc = useStore(state.store, (s) => s.document);
  const [importing, setImporting] = useState<{replace?: DatasetId} | undefined>();
  const [portal, setPortal] = useState<{replace?: DatasetId}>();
  const [removing, setRemoving] = useState<Dataset>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const [inventory, setInventory] = useState<{missing: string[]; orphans: string[]}>();
  const [cleanupMessage, setCleanupMessage] = useState('');
  const refresh = () =>
    session.getDatasets().inventory(new AbortController().signal).then(setInventory);
  useEffect(() => {
    const control = new AbortController();
    void session
      .getDatasets()
      .inventory(control.signal)
      .then((value) => {
        if (!control.signal.aborted) setInventory(value);
      })
      .catch((error: unknown) => {
        if (!control.signal.aborted) report(error);
      });
    return () => control.abort();
  }, [session, doc.revision]);
  const datasets = Object.values(doc.datasets).filter((d) => !d.removedAt);
  return (
    <section>
      <div className="section-heading">
        <h2>Daten</h2>
        <button disabled={session.readOnly || busy} onClick={() => setImporting({})}>
          Datei hinzufügen
        </button>
        <button disabled={session.readOnly || busy} onClick={() => setPortal({})}>
          Aus Portal hinzufügen
        </button>
      </div>
      {datasets.length === 0 ? (
        <p>Noch keine Dateneinbindungen.</p>
      ) : (
        <ul className="dataset-list">
          {datasets.map((dataset) => {
            const version = doc.datasetVersions[dataset.currentVersionId]!;
            return (
              <li key={dataset.id}>
                <div>
                  <input
                    aria-label={`Anzeigename ${dataset.sqlName}`}
                    defaultValue={dataset.name}
                    disabled={session.readOnly}
                    onBlur={(event) => {
                      if (event.target.value !== dataset.name)
                        try {
                          session.renameDataset(dataset.id, event.target.value);
                        } catch (error) {
                          report(error);
                        }
                    }}
                  />
                  <code>data.{dataset.sqlName}</code>
                  <span>
                    {version.rowCount ?? '?'} Zeilen ·{' '}
                    {version.backing.kind === 'artifact'
                      ? !inventory
                        ? 'Datei noch ungeprüft'
                        : inventory.missing.includes(version.backing.artifactId)
                          ? 'Nicht verfügbar · Datei fehlt'
                          : session.mode === 'temporary'
                            ? 'Nur diese Sitzung'
                            : 'Lokal gesichert · Hash beim Import geprüft'
                      : version.backing.kind === 'public-parquet'
                        ? 'Referenz · Externer Stand nicht eingefroren'
                        : 'Nicht verfügbar'}
                  </span>
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void session
                      .getDatasets()
                      .inspect(dataset.id, new AbortController().signal)
                      .then(setPreview)
                      .catch(report)
                      .finally(() => setBusy(false));
                  }}
                >
                  Daten ansehen
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void session
                      .getDatasets()
                      .export(dataset.id, new AbortController().signal)
                      .then((data) =>
                        downloadStream(
                          data,
                          `${dataset.sqlName}.parquet`,
                          'application/vnd.apache.parquet',
                        ),
                      )
                      .catch(report)
                      .finally(() => setBusy(false));
                  }}
                >
                  Parquet exportieren
                </button>
                {version.backing.kind === 'public-parquet' && (
                  <button
                    disabled={session.readOnly || busy}
                    onClick={() => {
                      setBusy(true);
                      void session
                        .getDatasets()
                        .keepLocal(dataset.id, new AbortController().signal)
                        .catch(report)
                        .finally(() => setBusy(false));
                    }}
                  >
                    Lokal sichern
                  </button>
                )}
                {version.origin.kind === 'portal' && (
                  <button
                    disabled={session.readOnly || busy}
                    onClick={() => setPortal({replace: dataset.id})}
                  >
                    Portalstand ersetzen
                  </button>
                )}
                <button
                  disabled={session.readOnly || busy}
                  onClick={() => setImporting({replace: dataset.id})}
                >
                  Daten ersetzen
                </button>
                <button disabled={session.readOnly || busy} onClick={() => setRemoving(dataset)}>
                  Einbindung entfernen
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {inventory && inventory.orphans.length > 0 && (
        <p>
          {inventory.orphans.length} nicht referenzierte Dateien.{' '}
          <button
            disabled={session.readOnly || busy}
            onClick={() => {
              setBusy(true);
              void session
                .getDatasets()
                .cleanOrphans(new AbortController().signal)
                .then(async (count) => {
                  setCleanupMessage(`${count} verwaiste Dateien entfernt.`);
                  await refresh();
                })
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            Verwaiste Dateien bereinigen
          </button>
        </p>
      )}
      {cleanupMessage && <p role="status">{cleanupMessage}</p>}
      {busy && <p role="status">Daten werden geprüft …</p>}
      {preview && (
        <div className="data-preview">
          <button onClick={() => setPreview(undefined)}>Vorschau schliessen</button>
          <p>Vorschau · maximal 200 Zeilen. NULL und Leerstring sind unterscheidbar.</p>
          <PreviewTable preview={preview} />
        </div>
      )}
      {portal && (
        <PortalImport session={session} {...portal} onClose={() => setPortal(undefined)} />
      )}
      {importing && <ImportDialog {...importing} onClose={() => setImporting(undefined)} />}
      {removing && (
        <Modal
          title="Einbindung entfernen"
          onClose={() => setRemoving(undefined)}
          showClose={false}
        >
          <p>{removing.name} entfernen?</p>
          <p>
            Die Einbindung verschwindet aus aktiven Datenquellen. Versionen und Herkunft bleiben
            erhalten; der SQL-Name bleibt reserviert.
          </p>
          <p>
            Explizite Analyse-Inputs:{' '}
            {Object.values(doc.analyses)
              .filter((a) =>
                a.inputs.some(
                  (i) => i.source.kind === 'dataset' && i.source.datasetId === removing.id,
                ),
              )
              .map((a) => a.name)
              .join(', ') || 'keine'}
            . Weitere Abhängigkeiten im SQL-Code sind nicht vollständig erfasst.
          </p>
          <button
            onClick={() => {
              session.removeDataset(removing.id);
              setRemoving(undefined);
            }}
          >
            Entfernen bestätigen
          </button>
          <button onClick={() => setRemoving(undefined)}>Abbrechen</button>
        </Modal>
      )}
    </section>
  );
}
function schemaDiff(previous: TableSchema, next: TableSchema) {
  const names = new Set([
    ...previous.columns.map((c) => c.name),
    ...next.columns.map((c) => c.name),
  ]);
  return (
    [...names]
      .map((name) => {
        const old = previous.columns.find((c) => c.name === name)?.logicalType;
        const now = next.columns.find((c) => c.name === name)?.logicalType;
        return old === now ? null : `${name}: ${old ?? 'neu'} → ${now ?? 'entfällt'}`;
      })
      .filter(Boolean)
      .join('; ') || 'Keine Schemaänderung'
  );
}
function ImportDialog({replace, onClose}: {replace?: DatasetId; onClose(): void}) {
  const {session} = useWorkspace();
  const service = session.getDatasets();
  const previous = replace ? session.document.datasets[replace] : undefined;
  const [file, setFile] = useState<File>();
  const [format, setFormat] = useState<'csv' | 'parquet'>('csv');
  const [name, setName] = useState(previous?.name ?? '');
  const [sqlName, setSqlName] = useState(previous?.sqlName ?? '');
  const [options, setOptions] = useState(defaults);
  const [original, setOriginal] = useState(true);
  const [preview, setPreview] = useState<ImportPreview>();
  const [dirty, setDirty] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const key = useRef<string | undefined>(undefined);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (key.current) void service.discard(key.current);
    },
    [service],
  );
  const select = (chosen: File | undefined) => {
    if (!chosen) return;
    // A newly chosen file invalidates the previous preview even when unsupported.
    // Otherwise confirming after an XLSX selection would still import the old CSV.
    if (key.current) void service.discard(key.current);
    key.current = undefined;
    setFile(undefined);
    setPreview(undefined);
    setDirty(true);
    const extension = chosen.name.split('.').pop()?.toLowerCase();
    if (extension !== 'csv' && extension !== 'parquet') {
      setError('Unterstützt sind CSV und Parquet. Projektarchive werden separat importiert.');
      return;
    }
    setFile(chosen);
    setFormat(extension);
    setOptions(defaults());
    setError('');
    if (!previous) {
      setName(chosen.name.replace(/\.[^.]+$/, '').slice(0, 120));
      setSqlName(service.suggestName(chosen.name));
    }
  };
  const change = (update: Partial<CsvImportOptions>) => {
    setOptions({...options, ...update});
    setDirty(true);
  };
  const load = () => {
    if (!file) return;
    controller.current = new AbortController();
    setBusy(true);
    setError('');
    const prior = key.current;
    void (async () => {
      if (prior) await service.discard(prior);
      const result = await service.preview(
        file,
        format,
        format === 'csv' ? options : undefined,
        controller.current!.signal,
      );
      key.current = result.key;
      setPreview(result);
      if (result.csvOptions) setOptions(result.csvOptions);
      setDirty(false);
    })()
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      )
      .finally(() => setBusy(false));
  };
  const confirm = () => {
    if (!preview || dirty) return;
    controller.current = new AbortController();
    setBusy(true);
    setError('');
    void service
      .confirm(
        preview.key,
        {name, sqlName, keepOriginal: original, ...(replace ? {replace} : {})},
        controller.current.signal,
      )
      .then(onClose)
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title={replace ? 'Daten ersetzen' : 'Datei importieren'}
      className="import-dialog"
      showClose={false}
      onClose={() => {
        if (busy) controller.current?.abort();
        else onClose();
      }}
    >
      <div
        className="file-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) {
            if (e.dataTransfer.files.length !== 1) setError('Bitte genau eine Datei wählen.');
            else select(e.dataTransfer.files[0]);
          }
        }}
      >
        <label>
          Datei (CSV oder Parquet, maximal 128 MiB)
          <input
            type="file"
            accept=".csv,.parquet"
            disabled={busy}
            onChange={(e) => select(e.target.files?.[0])}
          />
        </label>
        <span>oder eine Datei hier ablegen</span>
      </div>
      <div className="import-fields">
        <label>
          Anzeigename
          <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          SQL-Name
          <input
            value={sqlName}
            disabled={!!replace || busy}
            onChange={(e) => setSqlName(e.target.value)}
          />
        </label>
      </div>
      {format === 'csv' && (
        <fieldset disabled={busy}>
          <legend>CSV-Vertrag · UTF-8 · Quote und Escape: doppelte Anführungszeichen</legend>
          <div className="import-fields">
            <label>
              Trennzeichen
              <select
                value={options.delimiter}
                onChange={(e) =>
                  change({
                    delimiter: e.target.value as CsvImportOptions['delimiter'],
                    columns: [],
                  })
                }
              >
                <option value=";">Semikolon</option>
                <option value=",">Komma</option>
                <option value={'\t'}>Tab</option>
                <option value="|">Pipe</option>
              </select>
            </label>
            <label>
              Dezimalzeichen
              <select
                value={options.decimalSeparator}
                onChange={(e) =>
                  change({decimalSeparator: e.target.value as '.' | ',', columns: []})
                }
              >
                <option value=".">Punkt</option>
                <option value=",">Komma</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.header}
                onChange={(e) => change({header: e.target.checked, columns: []})}
              />
              Kopfzeile
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.emptyStringIsNull}
                onChange={(e) => change({emptyStringIsNull: e.target.checked})}
              />
              Ungequotetes leeres Feld ist NULL
            </label>
            <label>
              Zusätzlicher NULL-Marker
              <input
                value={options.nullStrings[0] ?? ''}
                onChange={(e) => change({nullStrings: e.target.value ? [e.target.value] : []})}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={original}
                onChange={(e) => setOriginal(e.target.checked)}
              />
              Original behalten {file ? `(+${file.size.toLocaleString('de-CH')} Bytes)` : ''}
            </label>
          </div>
          {options.columns.length > 0 && (
            <div className="column-options">
              {options.columns.map((column, i) => (
                <div key={i}>
                  <label>
                    Spalte {i + 1}
                    <input
                      value={column.name}
                      onChange={(e) =>
                        change({
                          columns: options.columns.map((c, index) =>
                            index === i ? {...c, name: e.target.value} : c,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Typ {i + 1}
                    <select
                      aria-label={`Typ ${i + 1}`}
                      value={column.logicalType}
                      onChange={(e) =>
                        change({
                          columns: options.columns.map((c, index) =>
                            index === i ? {...c, logicalType: e.target.value} : c,
                          ),
                        })
                      }
                    >
                      {[...new Set([column.logicalType, ...types])].map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <button disabled={!file || busy} onClick={load}>
        Vorschau laden
      </button>
      {preview && (
        <>
          <p>
            Maximal 200 Zeilen. Typen sind Vorschläge; der vollständige Import prüft jeden Wert
            strikt.
          </p>
          {previous && (
            <p className="schema-diff">
              Schemaänderung:{' '}
              {schemaDiff(
                session.document.datasetVersions[previous.currentVersionId]!.schema,
                preview.schema,
              )}
            </p>
          )}
          <PreviewTable preview={preview} />
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && <p role="status">Datei wird verarbeitet …</p>}
      <div className="dialog-actions">
        <button className="primary" disabled={!preview || dirty || busy} onClick={confirm}>
          Import bestätigen
        </button>
        <button
          onClick={() => {
            if (busy) controller.current?.abort();
            else onClose();
          }}
        >
          {busy ? 'Verarbeitung abbrechen' : 'Schliessen'}
        </button>
      </div>
    </Modal>
  );
}
