import {it, expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {WorkspaceArchive} from '../../src/application/workspaceArchive';
import {ZipArchiveCodec} from '../../src/infrastructure/archive/zip';
import {MemoryArtifactStore} from '../../src/infrastructure/storage/artifactStore';
import {MemoryWorkspaceRepository} from '../../src/infrastructure/storage/memoryRepository';
import {checkedId, parseWorkspace} from '../../src/domain/workspace';
it('AT-060 REQ-033: archive URLs with credentials, tokens or executable schemes are rejected before publication/export', async () => {
  const codec = new ZipArchiveCodec(),
    repository = new MemoryWorkspaceRepository(),
    signal = new AbortController().signal;
  const archive = new WorkspaceArchive({
    codec,
    repository,
    artifacts: new MemoryArtifactStore(1024),
    newId: () => checkedId(crypto.randomUUID()),
    now: () => new Date().toISOString(),
    lock: {
      acquire: async (workspaceId) => ({workspaceId, mode: 'writer', release: async () => {}}),
    },
  });
  const original = parseWorkspace(
    JSON.parse(await readFile('fixtures/workspace.recipe.json', 'utf8')),
  );
  for (const field of ['backing', 'canonical'])
    for (const url of [
      'https://user:password@example.org/table.parquet',
      'https://example.org/table.parquet?token=secret',
      'javascript:alert(1)',
      'file:///tmp/private.parquet',
      'http://example.org/table.parquet',
    ]) {
      const project = structuredClone(original),
        version = Object.values(project.datasetVersions)[0]!;
      if (field === 'backing') version.backing = {kind: 'public-parquet', url};
      else
        version.origin = {
          kind: 'portal',
          providerId: 'test',
          target: {kind: 'dataset', entryId: 'external'},
          tableId: 'table',
          observedAt: version.createdAt,
          canonicalUrl: url,
        };
      const manifest = {
        archiveFormat: 'datenwerkstatt',
        archiveVersion: 1,
        exportedAt: new Date().toISOString(),
        mode: 'recipe',
        project,
        files: [],
        omissions: [],
      };
      const zip = await codec.write(
        new Map([['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))]]),
        signal,
      );
      await expect(archive.inspect(zip, signal)).rejects.toMatchObject({code: 'ARCHIVE_INVALID'});
      await expect(archive.export(project, 'recipe', false, signal)).rejects.toThrow();
    }
  const portable = structuredClone(original);
  Object.values(portable.datasetVersions)[0]!.backing = {
    kind: 'public-parquet',
    url: 'https://public.example.org/table.parquet',
  };
  const exported = await archive.export(portable, 'recipe', false, signal);
  expect((await archive.inspect(exported.blob, signal)).inspection.missingSources).toBe(3);
  expect(await repository.list()).toHaveLength(0);
});
