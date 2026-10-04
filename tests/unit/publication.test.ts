import {expect, it, vi} from 'vitest';
import {MemoryWorkspaceRepository} from '../../src/infrastructure/storage/memoryRepository';
import {MemoryArtifactStore} from '../../src/infrastructure/storage/artifactStore';
import {PersistenceCoordinator} from '../../src/application/persistenceCoordinator';
import {DatasetService} from '../../src/application/datasetService';
import {emptyWorkspace, checkedId} from '../../src/domain/workspace';
import type {FileImportEngine} from '../../src/application/importPorts';
import type {TableSchema} from '../../src/domain/model';
const now = () => '2026-10-03T12:00:00Z';
const newId = <K extends string>() => checkedId<K>(crypto.randomUUID());
const schema: TableSchema = {
  columns: [
    {name: 'id', logicalType: 'VARCHAR', nullable: true, roles: ['identifier'], metadata: {}},
  ],
  metadata: {},
};
async function setup() {
  const repository = new MemoryWorkspaceRepository();
  const document = await repository.create(emptyWorkspace(newId<'workspace'>(), 'Test', now()));
  const persistence = new PersistenceCoordinator(document, repository);
  const artifacts = new MemoryArtifactStore(1024);
  // Fault ports are deliberately unit-test-only; real DuckDB coverage is in integration/imports.
  const engine: FileImportEngine = {
    preview: async () => ({key: crypto.randomUUID(), schema, rows: [['001']]}),
    prepare: async () => ({schema, rowCount: '1', data: new Blob(['unit-fixture']).stream()}),
    release: async () => {},
    inspect: async () => ({key: '', schema, rows: []}),
    dispose: async () => {},
  };
  const service = new DatasetService({
    document: () => persistence.document,
    assertWriter: () => {},
    publish: (change) => persistence.publish(change),
    engine,
    artifacts,
    flush: () => persistence.flush(),
    newId,
    now,
  });
  const file = {name: 'daten.csv', size: 4, stream: () => new Blob(['001\n']).stream()};
  const preview = await service.preview(file, 'csv', undefined, new AbortController().signal);
  const confirm = () =>
    service.confirm(
      preview.key,
      {name: 'Daten', sqlName: 'daten', keepOriginal: true},
      new AbortController().signal,
    );
  return {repository, document, persistence, artifacts, engine, service, file, preview, confirm};
}
it('AT-013: quota failure leaves persisted and visible documents unchanged; explicit retry succeeds once', async () => {
  const s = await setup();
  const write = vi
    .spyOn(s.artifacts, 'write')
    .mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  await expect(s.confirm()).rejects.toMatchObject({name: 'QuotaExceededError'});
  expect(s.persistence.document).toEqual(s.document);
  expect(await s.repository.load(s.document.workspace.id)).toEqual(s.document);
  const first = s.confirm();
  const second = s.confirm();
  expect(first).toBe(second);
  await first;
  expect(Object.keys(s.persistence.document.datasets)).toHaveLength(1);
  expect(write).toHaveBeenCalledTimes(3);
  await s.service.close();
  s.persistence.stopTimers();
});
it('AT-014: completed files followed by failed metadata commit remain unreferenced; previous project is usable', async () => {
  const s = await setup();
  vi.spyOn(s.repository, 'commit').mockRejectedValueOnce(Error('transaction aborted'));
  await expect(s.confirm()).rejects.toThrow('transaction aborted');
  expect(s.persistence.document).toEqual(s.document);
  expect(await s.repository.load(s.document.workspace.id)).toEqual(s.document);
  const orphans = [];
  for await (const file of s.artifacts.list(s.document.workspace.id)) orphans.push(file);
  expect(orphans).toHaveLength(2);
  expect(s.persistence.state).toBe('error');
  await s.confirm();
  expect(Object.keys(s.persistence.document.artifacts)).toHaveLength(2);
  await s.service.close();
  s.persistence.stopTimers();
});
it('AT-011/018: publication preserves concurrent editor changes and does not claim them saved', async () => {
  const s = await setup();
  let resume: (() => void) | undefined;
  const commit = s.repository.commit.bind(s.repository);
  vi.spyOn(s.repository, 'commit').mockImplementationOnce(async (d, revision) => {
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
    return commit(d, revision);
  });
  const operation = s.confirm();
  await vi.waitFor(() => expect(resume).toBeTypeOf('function'));
  expect(Object.keys(s.persistence.document.datasets)).toHaveLength(0);
  s.persistence.mutate((d) => {
    d.workspace.description = 'Neu während des Imports';
  });
  resume!();
  await operation;
  expect(s.persistence.document.workspace.description).toBe('Neu während des Imports');
  expect(s.persistence.state).toBe('dirty');
  expect((await s.repository.load(s.document.workspace.id))?.workspace.description).toBeUndefined();
  await s.persistence.flush();
  expect((await s.repository.load(s.document.workspace.id))?.workspace.description).toBe(
    'Neu während des Imports',
  );
  await s.service.close();
  s.persistence.stopTimers();
});
it('AT-019: replacement advances current version and retains immutable old bytes and metadata', async () => {
  const s = await setup();
  const id = await s.confirm();
  const original = s.persistence.document.datasets[id]!;
  const oldVersion = structuredClone(
    s.persistence.document.datasetVersions[original.currentVersionId],
  );
  const next = await s.service.preview(s.file, 'csv', undefined, new AbortController().signal);
  await s.service.confirm(
    next.key,
    {name: 'Daten neu', sqlName: 'daten', keepOriginal: false, replace: id},
    new AbortController().signal,
  );
  expect(s.persistence.document.datasets[id]?.currentVersionId).not.toBe(original.currentVersionId);
  expect(s.persistence.document.datasetVersions[original.currentVersionId]).toEqual(oldVersion);
  expect(Object.keys(s.persistence.document.datasetVersions)).toHaveLength(2);
  expect(Object.keys(s.persistence.document.datasets)).toHaveLength(1);
  await s.service.close();
  s.persistence.stopTimers();
});
