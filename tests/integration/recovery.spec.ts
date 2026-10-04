import {test, expect} from '../persistentBrowser';
import {rawZip} from '../archive/rawZip';
test('P6 AT-060: native browser decompressor enforces actual expansion with forged ZIP sizes', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const zip = await rawZip([
    {name: 'manifest.json', data: new Uint8Array(2 * 1024 * 1024), method: 8, size: 100},
  ]).arrayBuffer();
  const result = await page.evaluate(
    async (bytes) => {
      const path = '/src/infrastructure/archive/zip.ts';
      const {ZipArchiveCodec} = (await import(
        path
      )) as typeof import('../../src/infrastructure/archive/zip');
      try {
        await new ZipArchiveCodec().read(
          new Blob([new Uint8Array(bytes)]),
          new AbortController().signal,
        );
        return '';
      } catch (e) {
        return String(e);
      }
    },
    Array.from(new Uint8Array(zip)),
  );
  expect(result).toContain('Tatsächliche ZIP-Expansion');
});
test('P6 AT-014 AT-064: failed import leaves recoverable OPFS staging; cleanup preserves another project and foreign files', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async () => {
    const hp = '/tests/spike/sqlHarness.ts',
      rp = '/src/application/recoveryService.ts',
      ap = '/src/infrastructure/storage/artifactStore.ts';
    const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
    const {RecoveryService} = (await import(
      rp
    )) as typeof import('../../src/application/recoveryService');
    const {OpfsArtifactStore} = (await import(
      ap
    )) as typeof import('../../src/infrastructure/storage/artifactStore');
    const {service, session, repository, artifacts} = await sqlHarness(
        30000,
        undefined,
        undefined,
        new OpfsArtifactStore(134217728),
      ),
      signal = new AbortController().signal;
    let phase = 'SQL/Keep';
    try {
      const a = session.createAnalysis('sql');
      session.updateAnalysis(a, {code: 'SELECT 73 AS n'});
      const run = await session.getAnalyses().run(a);
      await session.getAnalyses().keep(session.document.runs[run]!.resultIds[0]!);
      phase = 'Archiv exportieren/prüfen';
      const before = structuredClone(session.document),
        exported = await session.exportArchive(
          'with-data',
          {keepTemporary: false, includeExternal: false},
          signal,
        ),
        candidate = await service.getArchive().inspect(exported.blob, signal);
      const create = repository.create.bind(repository);
      repository.create = async () => {
        throw Error('metadata rejected');
      };
      let failure = '';
      phase = 'Archivimport mit Metadatenfehler';
      try {
        await service.importArchive(candidate.id, signal);
      } catch (e) {
        failure = String(e);
      }
      repository.create = create;
      const rows = await repository.list();
      const workspaceIds = [];
      for await (const id of artifacts.listWorkspaceIds()) workspaceIds.push(id);
      phase = 'Fremde Datei erstellen';
      const root = await navigator.storage.getDirectory(),
        workspaces = await root.getDirectoryHandle('workspaces');
      let foreign: FileSystemFileHandle | undefined;
      for (const id of workspaceIds)
        if (id !== before.workspace.id) {
          phase = `Fremdes Workspaceverzeichnis ${id}; Importfehler: ${failure}`;
          const ws = await workspaces.getDirectoryHandle(id);
          phase = 'Fremdes Artefaktverzeichnis';
          const dir = await ws.getDirectoryHandle('artifacts');
          phase = 'Fremdes Filehandle';
          foreign = await dir.getFileHandle('unrelated.txt', {create: true});
          phase = 'Fremdes Writable';
          const writer = await foreign.createWritable();
          phase = 'Fremde Bytes schreiben';
          await writer.write('preserve me');
          phase = 'Fremde Datei schliessen';
          await writer.close();
        }
      phase = 'Recovery bereinigen';
      const cleaned = await new RecoveryService(artifacts).cleanAbandoned(
        repository,
        {acquire: async (workspaceId) => ({workspaceId, mode: 'writer', release: async () => {}})},
        signal,
      );
      phase = 'Original verifizieren';
      const after = await repository.load(before.workspace.id),
        valid = await artifacts.verify(Object.values(before.artifacts)[0]!, signal);
      phase = 'Fremde Datei lesen';
      return {
        failure,
        count: rows.length,
        cleaned,
        unchanged: JSON.stringify(before) === JSON.stringify(after),
        valid,
        foreign: foreign ? await (await foreign.getFile()).text() : '',
      };
    } catch (error) {
      throw Error(`${phase}: ${String(error)}`);
    } finally {
      await service.close();
    }
  });
  expect(result.failure).toContain('metadata rejected');
  expect(result.count).toBe(1);
  expect(result.cleaned.removed).toHaveLength(1);
  expect(result.cleaned.failures).toHaveLength(0);
  expect(result.unchanged).toBe(true);
  expect(result.valid).toBe('valid');
  expect(result.foreign).toBe('preserve me');
});
test('P6 AT-012 AT-015 AT-017 AT-061: tab death interrupts real query, saved results remain, missing/corrupt bytes preserve code', async ({
  page,
  context,
}) => {
  await page.goto('/workspaces');
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Recovery');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Recovery', exact: true})).toBeVisible();
  const url = page.url();
  const state = await page.evaluate(async () => {
    const path = '/src/app/services.ts';
    const {services} = (await import(path)) as typeof import('../../src/app/services');
    const session = await services.workspaces.open(location.pathname.split('/')[2]!);
    const a = session.createAnalysis('sql');
    session.updateAnalysis(a, {code: 'SELECT 73 AS antwort'});
    const run = await session.getAnalyses().run(a),
      result = session.document.runs[run]!.resultIds[0]!;
    await session.getAnalyses().keep(result);
    const b = session.createAnalysis('sql');
    session.updateAnalysis(b, {
      code: 'SELECT sum(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i)',
    });
    void session
      .getAnalyses()
      .run(b)
      .catch(() => {});
    return {a, b, result, artifact: Object.values(session.document.artifacts)[0]!};
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = '/src/app/services.ts';
        const {services} = (await import(path)) as typeof import('../../src/app/services');
        const session = await services.workspaces.open(location.pathname.split('/')[2]!);
        const active = Object.values(session.document.runs).some((r) => r.status === 'running');
        if (active) await session.flush();
        return active;
      }),
    )
    .toBe(true);
  const reader = await context.newPage();
  await reader.goto(url);
  await expect(reader.getByText(/Nur lesend/)).toBeVisible();
  await expect(reader.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true})).toBeDisabled();
  await page.close();
  await reader.getByRole('button', {name: 'Schreibrecht erneut anfordern'}).click();
  await expect(reader.getByLabel('Beschreibung', {exact: true})).toBeEnabled();
  const recovered = await reader.evaluate(async (state) => {
    const path = '/src/app/services.ts';
    const {services} = (await import(path)) as typeof import('../../src/app/services');
    const s = await services.workspaces.open(location.pathname.split('/')[2]!);
    await s.flush();
    const status = Object.values(s.document.runs).find(
      (r) => r.snapshot.analysisId === state.b,
    )!.status;
    const rows = await s
      .getAnalyses()
      .page(state.result, {offset: 0, size: 100, sort: []}, new AbortController().signal);
    const root = await navigator.storage.getDirectory(),
      ws = await (
        await root.getDirectoryHandle('workspaces')
      ).getDirectoryHandle(s.document.workspace.id),
      dir = await ws.getDirectoryHandle('artifacts'),
      handle = await dir.getFileHandle(state.artifact.id),
      file = await handle.getFile(),
      bytes = new Uint8Array(await file.arrayBuffer());
    bytes[100] = (bytes[100] ?? 0) ^ 1;
    const writer = await handle.createWritable();
    await writer.write(bytes);
    await writer.close();
    return {status, rows};
  }, state);
  expect(recovered.status).toBe('interrupted');
  expect(recovered.rows.rows).toEqual([['73']]);
  await reader.reload();
  await reader.getByRole('button', {name: 'Integrität prüfen'}).click();
  await expect(reader.getByText(/1 beschädigte/)).toBeVisible();
  await reader.goto(`${url}/sql/${state.a}`);
  await expect(reader.getByRole('alert').filter({hasText: 'ARTIFACT_CORRUPT'})).toBeVisible();
  await expect(reader.locator('.result-grid tbody tr')).toHaveCount(0);
  await reader.evaluate(async (artifact) => {
    const root = await navigator.storage.getDirectory(),
      dir = await (
        await (await root.getDirectoryHandle('workspaces')).getDirectoryHandle(artifact.workspaceId)
      ).getDirectoryHandle('artifacts');
    await dir.removeEntry(artifact.id);
  }, state.artifact);
  await reader.reload();
  await expect(reader.getByRole('alert').filter({hasText: 'ARTIFACT_MISSING'})).toBeVisible();
  await expect(reader.locator('.monaco-editor')).toContainText('73');
});
