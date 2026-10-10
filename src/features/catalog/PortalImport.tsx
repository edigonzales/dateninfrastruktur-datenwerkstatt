import {Button, Input, Select, FormField, Notice} from '../../ui/Controls';
import {Modal} from '../../ui/Modal';
import {useEffect, useRef, useState} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {services} from '../../app/services';
import {PortalAccess} from '../../infrastructure/catalog/portal';
import type {CatalogSelection, ResolvedCatalogTable} from '../../application/catalogPorts';
import type {EditingSession} from '../../application/workspaceService';
import type {ImportPreview} from '../../application/importPorts';
import type {DatasetId} from '../../domain/model';
import {PreviewTable} from '../data/DataSection';
export function PortalImport({
  session,
  initial,
  replace,
  onClose,
}: {
  session?: EditingSession;
  initial?: CatalogSelection;
  replace?: DatasetId;
  onClose(completed?: boolean): void;
}) {
  const navigate = useNavigate();
  const access = useRef(
    new PortalAccess(
      services.config!,
      ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname),
    ),
  ).current;
  const [provider, setProvider] = useState(
    initial?.providerId ?? access.config.portalProviders[0]?.id ?? '',
  );
  const [value, setValue] = useState('');
  const [tables, setTables] = useState<ResolvedCatalogTable[]>([]);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<ImportPreview>();
  const [target, setTarget] = useState(session?.document.workspace.id ?? 'new');
  const [workspaces, setWorkspaces] = useState<
    Awaited<ReturnType<typeof services.workspaces.list>>
  >([]);
  const [active, setActive] = useState<EditingSession | undefined>(session);
  const [name, setName] = useState('');
  const [sqlName, setSqlName] = useState('');
  const [local, setLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState<Awaited<ReturnType<PortalAccess['search']>>>([]);
  const controller = useRef(new AbortController());
  const stage = useRef<{session: EditingSession; key: string} | undefined>(undefined);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (!controller.current.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (selection: CatalogSelection) => {
    const result = await access.resolve(selection, controller.current.signal);
    setTables(result);
    setSelected(result[0]!.tableId);
    setPreview(undefined);
  };
  useEffect(() => {
    controller.current = new AbortController();
    void services.workspaces.list().then(setWorkspaces);
    if (initial) void act(() => resolve(initial));
    return () => {
      controller.current.abort();
      if (stage.current) void stage.current.session.getDatasets().discard(stage.current.key);
    };
    // This dialog captures its initial route selection once; editing uses the explicit load action.
  }, []);
  const load = () =>
    act(async () => {
      const table = tables.find((t) => t.tableId === selected);
      if (!table) return;
      if (stage.current) await stage.current.session.getDatasets().discard(stage.current.key);
      // A new workspace is created only on final confirmation; preview may use the active session
      // or an isolated file engine, owned by this dialog, below.
      if (target === 'new') {
        setPreview(await services.workspaces.previewPortal(table, controller.current.signal));
        setName(table.title.slice(0, 120));
        setSqlName(table.suggestedSqlName);
      } else {
        const chosen = session ?? (await services.workspaces.open(target));
        setActive(chosen);
        const result = await chosen.getDatasets().previewPortal(table, controller.current.signal);
        stage.current = {session: chosen, key: result.key};
        setPreview(result);
        const previous = replace ? chosen.document.datasets[replace] : undefined;
        setName(previous?.name ?? table.title.slice(0, 120));
        setSqlName(previous?.sqlName ?? chosen.getDatasets().suggestName(table.suggestedSqlName));
      }
    });
  return (
    <Modal
      title="Aus Portal hinzufügen"
      className="import-dialog"
      showClose={false}
      onClose={() => {
        controller.current.abort();
        onClose();
      }}
      footer={
        <>
          <Button
            onClick={() => {
              controller.current.abort();
              onClose();
            }}
          >
            Schliessen
          </Button>
          {preview && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const table = tables.find((t) => t.tableId === selected)!;
                  let chosen = active;
                  if (target === 'new') {
                    const observed = await access.fetch(
                      table.publicParquetUrl,
                      controller.current.signal,
                    );
                    if (observed.sha256 !== preview.sourceSha256)
                      throw Error(
                        'SOURCE_CHANGED: Quelle seit Vorschau geändert. Vorschau erneut laden.',
                      );
                    const created = await services.workspaces.create('Portal-Arbeitsbereich');
                    chosen = await services.workspaces.open(created.workspace.id);
                    setTarget(created.workspace.id);
                    setActive(chosen);
                  }
                  if (!chosen) throw Error('Zielarbeitsbereich fehlt.');
                  let key = stage.current?.session === chosen ? stage.current.key : undefined;
                  if (!key) {
                    const p = await chosen
                      .getDatasets()
                      .previewPortal(table, controller.current.signal);
                    if (p.sourceSha256 !== preview.sourceSha256) {
                      await chosen.getDatasets().discard(p.key);
                      throw Error('SOURCE_CHANGED: Quelle seit Vorschau geändert.');
                    }
                    key = p.key;
                    stage.current = {session: chosen, key};
                  }
                  await chosen
                    .getDatasets()
                    .confirm(
                      key,
                      {name, sqlName, keepOriginal: false, local, ...(replace ? {replace} : {})},
                      controller.current.signal,
                    );
                  stage.current = undefined;
                  await navigate({
                    to: '/workspaces/$workspaceId/data',
                    params: {workspaceId: chosen.document.workspace.id},
                    replace: true,
                  });
                  onClose(true);
                })
              }
            >
              Portalimport bestätigen
            </Button>
          )}
        </>
      }
    >
      {!access.config.portalProviders.length ? (
        <p>Kein Portalprovider konfiguriert. Produktive Portal-URL fehlt im Entwicklungsprofil.</p>
      ) : (
        <>
          <FormField label={<>Portal</>}>
            <Select
              disabled={busy}
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setTables([]);
                setPreview(undefined);
              }}
            >
              {access.config.portalProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={<>Dataset-ID oder Portal-URL</>}>
            <Input value={value} disabled={busy} onChange={(e) => setValue(e.target.value)} />
          </FormField>
          <Button
            disabled={busy || !value.trim()}
            onClick={() => void act(() => resolve(access.selection(provider, value)))}
          >
            Kontext laden
          </Button>
          <a href={access.provider(provider).baseUrl} target="_blank" rel="noreferrer">
            Im Portal suchen
          </a>
          {access.provider(provider).indexUrl && (
            <>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    setEntries(await access.search(provider, value, controller.current.signal)),
                  )
                }
              >
                Index durchsuchen
              </Button>
              <ul>
                {entries.map((e) => (
                  <li key={e.key}>
                    <Button
                      onClick={() =>
                        void act(() =>
                          resolve({
                            providerId: provider,
                            target: e.target,
                            ...(e.tableId ? {tableId: e.tableId} : {}),
                          }),
                        )
                      }
                    >
                      {e.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {tables.length > 0 && (
            <>
              <FormField label={<>Portaltabelle</>}>
                <Select
                  disabled={busy}
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setPreview(undefined);
                  }}
                >
                  {tables.map((t) => (
                    <option key={t.tableId} value={t.tableId}>
                      {t.title}
                    </option>
                  ))}
                </Select>
              </FormField>
              <p>{tables.find((t) => t.tableId === selected)?.license ?? 'Keine Lizenzangabe'}</p>
              {!session && (
                <FormField label={<>Zielarbeitsbereich</>}>
                  <Select
                    disabled={busy}
                    value={target}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setPreview(undefined);
                    }}
                  >
                    <option value="new">Neuer Arbeitsbereich</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              )}
              <Button disabled={busy} onClick={() => void load()}>
                Portalvorschau laden
              </Button>
            </>
          )}
          {preview && (
            <>
              <PreviewTable preview={preview} />
              <FormField label={<>Anzeigename</>}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label={<>SQL-Name</>}>
                <Input
                  disabled={!!replace}
                  value={sqlName}
                  onChange={(e) => setSqlName(e.target.value)}
                />
              </FormField>
              <FormField label={<>Lokal sichern</>}>
                <Input
                  type="checkbox"
                  checked={local}
                  onChange={(e) => setLocal(e.target.checked)}
                />
              </FormField>
              <p>
                {local
                  ? 'Datei wird mit geprüftem Hash gesichert.'
                  : 'Referenz · Externer Stand nicht eingefroren. Bei jeder Verwendung erneut geprüft.'}
              </p>
              {replace && (
                <p>
                  Schemaänderung:{' '}
                  {JSON.stringify(
                    active?.document.datasetVersions[
                      active.document.datasets[replace]!.currentVersionId
                    ]?.schema.columns.map((c) => [c.name, c.logicalType]),
                  )}{' '}
                  → {JSON.stringify(preview.schema.columns.map((c) => [c.name, c.logicalType]))}
                </p>
              )}
            </>
          )}
        </>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {busy && <Notice tone="info">Portal wird geprüft …</Notice>}
    </Modal>
  );
}
export function PortalOpen() {
  const navigate = useNavigate();
  try {
    const initial = new PortalAccess(
      services.config!,
      ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname),
    ).deepLink(location.search);
    return (
      <main>
        <PortalImport
          initial={initial}
          onClose={(completed) => {
            if (!completed) void navigate({to: '/workspaces', replace: true});
          }}
        />
      </main>
    );
  } catch (e) {
    return <main role="alert">{e instanceof Error ? e.message : String(e)}</main>;
  }
}
