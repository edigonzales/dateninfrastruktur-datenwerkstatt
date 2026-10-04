import {expect, test} from '../persistentBrowser';
import {isolateOpfs} from '../isolateOpfs';
import {readFile} from 'node:fs/promises';
test.beforeEach(async ({page}) => {
  await page.goto('/tests/spike/index.html');
});
test('P2 / AT-008 AT-010: strict CSV → hashed OPFS → fresh DuckDB retains values, NULL and empty strings', async ({
  page,
}) => {
  const csv = await readFile('fixtures/csv-edge-cases.csv', 'utf8');
  const result = await page.evaluate(async (text) => {
    const enginePath = '/src/infrastructure/sqlrooms/fileImportEngine.ts';
    const storagePath = '/src/infrastructure/storage/artifactStore.ts';
    const workspacePath = '/src/domain/workspace.ts';
    const {DuckDbFileImportEngine} = (await import(
      enginePath
    )) as typeof import('../../src/infrastructure/sqlrooms/fileImportEngine');
    const {OpfsArtifactStore} = (await import(
      storagePath
    )) as typeof import('../../src/infrastructure/storage/artifactStore');
    const {checkedId} = (await import(
      workspacePath
    )) as typeof import('../../src/domain/workspace');
    const limit = 134217728;
    const engine = new DuckDbFileImportEngine(limit);
    const store = new OpfsArtifactStore(limit);
    const signal = new AbortController().signal;
    const blob = new Blob([text]);
    const preview = await engine.preview(
      {name: 'edge.csv', size: blob.size, stream: () => blob.stream()},
      'csv',
      undefined,
      signal,
    );
    const prepared = await engine.prepare(preview.key, signal);
    const artifact = await store.write(
      checkedId<'workspace'>(crypto.randomUUID()),
      prepared.data,
      'application/vnd.apache.parquet',
      signal,
    );
    const hash = await store.verify(artifact, signal);
    await engine.dispose();
    const fresh = new DuckDbFileImportEngine(limit);
    try {
      const reopened = await fresh.inspect(await store.read(artifact, signal), signal);
      return {preview, rowCount: prepared.rowCount, reopened, hash};
    } finally {
      await fresh.dispose();
      await store.delete(artifact);
    }
  }, csv);
  expect(result.rowCount).toBe('4');
  expect(result.hash).toBe('valid');
  expect(result.preview.csvOptions?.columns[0]?.logicalType).toBe('VARCHAR');
  expect(result.reopened.rows).toEqual([
    ['001', 'Auenried; Nord', '10', 'erste Zeile\nzweite Zeile'],
    ['002', 'Bärgthal', null, 'NULL'],
    ['003', '', '0', ''],
    ['004', 'Lindenwil', '-1', null],
  ]);
});
test('P2 / AT-009 AT-020: late conversion error, header-only CSV and invalid bytes', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = '/src/infrastructure/sqlrooms/fileImportEngine.ts';
    const {DuckDbFileImportEngine} = (await import(
      path
    )) as typeof import('../../src/infrastructure/sqlrooms/fileImportEngine');
    const engine = new DuckDbFileImportEngine(134217728);
    const signal = new AbortController().signal;
    const input = (text: string) => {
      const blob = new Blob([text]);
      return {name: 'test.csv', size: blob.size, stream: () => blob.stream()};
    };
    try {
      const late = await engine.preview(
        input(
          'id;wert\n' +
            Array.from({length: 5100}, (_, i) => `${i + 1};${i === 4998 ? 'kaputt' : '7'}`).join(
              '\n',
            ),
        ),
        'csv',
        undefined,
        signal,
      );
      let error = '';
      try {
        await engine.prepare(late.key, signal);
      } catch (failure) {
        error = String(failure);
      }
      const empty = await engine.preview(input('id;wert\n'), 'csv', undefined, signal);
      const prepared = await engine.prepare(empty.key, signal);
      const failures: string[] = [];
      for (const [text, format] of [
        ['', 'csv'],
        ['bad\0bytes', 'csv'],
        ['PAR1bad', 'parquet'],
      ] as const) {
        try {
          await engine.preview(input(text), format, undefined, signal);
          failures.push('unexpected-success');
        } catch (failure) {
          failures.push(String(failure));
        }
      }
      return {error, previewRows: late.rows.length, emptyRows: prepared.rowCount, failures};
    } finally {
      await engine.dispose();
    }
  });
  expect(result.previewRows).toBe(200);
  expect(result.error).toMatch(/wert/);
  expect(result.error).toMatch(/5000|4999|kaputt/);
  expect(result.emptyRows).toBe('0');
  expect(result.failures).toHaveLength(3);
  expect(result.failures).not.toContain('unexpected-success');
});

test('P2 / AT-014 AT-017: reload finds true orphans, writer cleanup preserves referenced and foreign bytes', async ({
  page,
  context,
}) => {
  const setup = await page.evaluate(async () => {
    const enginePath = '/src/infrastructure/sqlrooms/fileImportEngine.ts';
    const storePath = '/src/infrastructure/storage/artifactStore.ts';
    const repoPath = '/src/infrastructure/storage/workspaceRepository.ts';
    const domainPath = '/src/domain/workspace.ts';
    const {DuckDbFileImportEngine} = (await import(
      enginePath
    )) as typeof import('../../src/infrastructure/sqlrooms/fileImportEngine');
    const {OpfsArtifactStore} = (await import(
      storePath
    )) as typeof import('../../src/infrastructure/storage/artifactStore');
    const {DexieWorkspaceRepository} = (await import(
      repoPath
    )) as typeof import('../../src/infrastructure/storage/workspaceRepository');
    const {emptyWorkspace, checkedId} = (await import(
      domainPath
    )) as typeof import('../../src/domain/workspace');
    const repo = new DexieWorkspaceRepository();
    const doc = await repo.create(
      emptyWorkspace(
        checkedId<'workspace'>(crypto.randomUUID()),
        'Crash-Probe',
        new Date().toISOString(),
      ),
    );
    const blob = new Blob(['id;wert\n001;7\n']);
    const engine = new DuckDbFileImportEngine(134217728);
    const store = new OpfsArtifactStore(134217728);
    const signal = new AbortController().signal;
    const preview = await engine.preview(
      {name: 'source.csv', size: blob.size, stream: () => blob.stream()},
      'csv',
      undefined,
      signal,
    );
    const prepared = await engine.prepare(preview.key, signal);
    const orphan = await store.write(
      doc.workspace.id,
      prepared.data,
      'application/vnd.apache.parquet',
      signal,
    );
    // Simulate process loss after full file write, before any metadata commit.
    const root = await navigator.storage.getDirectory();
    const foreign = await root.getFileHandle('foreign-test-file', {create: true});
    const writer = await foreign.createWritable();
    await writer.write('keep');
    await writer.close();
    return {workspaceId: doc.workspace.id, path: orphan.path};
  });
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`/workspaces/${setup.workspaceId}`);
  await expect(reopened.getByText('1 nicht referenzierte Dateien.', {exact: false})).toBeVisible();
  await reopened.getByRole('button', {name: 'Verwaiste Dateien bereinigen'}).click();
  await expect(reopened.getByText('1 verwaiste Dateien entfernt.', {exact: true})).toBeVisible();
  const proof = await reopened.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const text = await (await (await root.getFileHandle('foreign-test-file')).getFile()).text();
    await root.removeEntry('foreign-test-file');
    return text;
  });
  expect(proof).toBe('keep');
  await expect(reopened.getByRole('heading', {name: 'Crash-Probe', exact: true})).toBeVisible();
});

test('P2 / AT-010: imported file survives browser process restart and removal of input file', async ({
  playwright,
  browserName,
}) => {
  const {mkdtemp, writeFile, readFile, rm} = await import('node:fs/promises');
  const {join} = await import('node:path');
  const {tmpdir} = await import('node:os');
  const folder = await mkdtemp(join(tmpdir(), 'datenwerkstatt-restart-'));
  const profile = join(folder, 'profile');
  const source = join(folder, 'original.parquet');
  const csvText = await readFile('fixtures/csv-edge-cases.csv', 'utf8');
  let context = await playwright[browserName].launchPersistentContext(profile, {headless: true});
  const storageKey = crypto.randomUUID();
  let cleanup = await isolateOpfs(context, storageKey);
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/tests/spike/index.html');
    const parquet = await page.evaluate(async (text) => {
      const path = '/src/infrastructure/sqlrooms/fileImportEngine.ts';
      const {DuckDbFileImportEngine} = (await import(
        path
      )) as typeof import('../../src/infrastructure/sqlrooms/fileImportEngine');
      const engine = new DuckDbFileImportEngine(134217728);
      const blob = new Blob([text]);
      const signal = new AbortController().signal;
      try {
        const preview = await engine.preview(
          {name: 'fixture.csv', size: blob.size, stream: () => blob.stream()},
          'csv',
          undefined,
          signal,
        );
        const prepared = await engine.prepare(preview.key, signal);
        return Array.from(new Uint8Array(await new Response(prepared.data).arrayBuffer()));
      } finally {
        await engine.dispose();
      }
    }, csvText);
    await writeFile(source, new Uint8Array(parquet));
    await page.goto('http://127.0.0.1:4173/workspaces');
    await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Neustart');
    await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
    await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
    await page.getByLabel('Datei (CSV oder Parquet, maximal 128 MiB)').setInputFiles(source);
    await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Import bestätigen'})).toBeEnabled();
    await page.getByRole('button', {name: 'Import bestätigen'}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const url = page.url();
    expect(Array.from(await readFile(source))).toEqual(parquet);
    await context.close();
    await rm(source);
    context = await playwright[browserName].launchPersistentContext(profile, {headless: true});
    cleanup = await isolateOpfs(context, storageKey);
    const reopened = await context.newPage();
    await reopened.goto(url);
    await reopened.getByRole('button', {name: 'Daten ansehen', exact: true}).click();
    await expect(reopened.getByRole('cell', {name: '001', exact: true})).toBeVisible();
    await expect(reopened.getByRole('cell', {name: 'Leerstring', exact: true})).toHaveCount(2);
  } finally {
    try {
      await cleanup();
    } finally {
      await context.close();
      await rm(folder, {recursive: true, force: true});
    }
  }
});

test('P2 / AT-061 partial: changed byte is rejected as ARTIFACT_CORRUPT before use', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = '/src/infrastructure/storage/artifactStore.ts';
    const domainPath = '/src/domain/workspace.ts';
    const {OpfsArtifactStore} = (await import(
      path
    )) as typeof import('../../src/infrastructure/storage/artifactStore');
    const {checkedId} = (await import(domainPath)) as typeof import('../../src/domain/workspace');
    const store = new OpfsArtifactStore(1024);
    const signal = new AbortController().signal;
    const artifact = await store.write(
      checkedId<'workspace'>(crypto.randomUUID()),
      new Blob(['original']).stream(),
      'text/plain',
      signal,
    );
    const root = await navigator.storage.getDirectory();
    const directory = await (
      await (await root.getDirectoryHandle('workspaces')).getDirectoryHandle(artifact.workspaceId)
    ).getDirectoryHandle('artifacts');
    const handle = await directory.getFileHandle(artifact.id);
    const writer = await handle.createWritable();
    await writer.write('changed!');
    await writer.close();
    let code = '';
    try {
      await store.read(artifact, signal);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) code = String(error.code);
    }
    const state = await store.verify(artifact, signal);
    await store.delete(artifact);
    return {code, state};
  });
  expect(result).toEqual({code: 'ARTIFACT_CORRUPT', state: 'corrupt'});
});
