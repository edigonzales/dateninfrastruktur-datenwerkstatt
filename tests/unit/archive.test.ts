import {it, expect, vi} from 'vitest';
import {RecoveryService} from '../../src/application/recoveryService';
import {WorkspaceService} from '../../src/application/workspaceService';
import {readFile} from 'node:fs/promises';
import {ZipArchiveCodec} from '../../src/infrastructure/archive/zip';
import {WorkspaceArchive} from '../../src/application/workspaceArchive';
import {MemoryArtifactStore} from '../../src/infrastructure/storage/artifactStore';
import {MemoryWorkspaceRepository} from '../../src/infrastructure/storage/memoryRepository';
import {emptyWorkspace, checkedId} from '../../src/domain/workspace';
import {archiveDefaults} from '../../src/application/archivePorts';
import {rawZip} from '../archive/rawZip';
const signal = () => new AbortController().signal;
const codec = new ZipArchiveCodec();
const data = new TextEncoder().encode('{}');
it('AT-059: supplied deflated recipe imports with new references and untouched code, no bytes/autorun', async () => {
  const repository = new MemoryWorkspaceRepository(),
    artifacts = new MemoryArtifactStore(134217728);
  const archive = new WorkspaceArchive({
    codec,
    repository,
    artifacts,
    newId: () => checkedId(crypto.randomUUID()),
    now: () => new Date().toISOString(),
    lock: {
      acquire: async (workspaceId) => ({workspaceId, mode: 'writer', release: async () => {}}),
    },
  });
  const candidate = await archive.inspect(
    new Blob([new Uint8Array(await readFile('fixtures/sample.dwproj'))]),
    signal(),
  );
  expect(candidate.inspection.missingSources).toBe(3);
  const original = JSON.parse(
    await readFile('fixtures/workspace.recipe.json', 'utf8'),
  ) as import('../../src/domain/model').WorkspaceDocument;
  const imported = await archive.commitImport(candidate.id, signal());
  expect(imported.workspace.id).not.toBe(original.workspace.id);
  expect(Object.keys(imported.artifacts)).toHaveLength(0);
  expect(Object.values(imported.analyses).map((a) => a.code)).toEqual(
    Object.values(original.analyses).map((a) => a.code),
  );
  expect(Object.keys(imported.datasets).some((id) => id in original.datasets)).toBe(false);
  expect(Object.values(imported.datasetVersions).every((v) => v.backing.kind === 'missing')).toBe(
    true,
  );
  for (const versions of [
    {archiveVersion: 2, project: original},
    {archiveVersion: 1, project: {...original, formatVersion: 2}},
  ]) {
    const manifest = {archiveFormat: 'datenwerkstatt', ...versions};
    await expect(
      archive.inspect(
        rawZip([{name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest))}]),
        signal(),
      ),
    ).rejects.toMatchObject({code: 'FORMAT_UNSUPPORTED'});
  }
  expect(await repository.list()).toHaveLength(1);
});
it('AT-060: reject traversal, alternate paths, duplicates, symlinks, ZIP encryption and unlisted bytes', async () => {
  for (const name of [
    '../manifest.json',
    '/manifest.json',
    'C:manifest.json',
    'a\\manifest.json',
    './manifest.json',
    'manifest.json\0',
    'artifacts/../manifest.json',
  ])
    await expect(codec.read(rawZip([{name, data}]), signal())).rejects.toThrow();
  await expect(
    codec.read(
      rawZip([
        {name: 'manifest.json', data},
        {name: 'manifest.json', data},
      ]),
      signal(),
    ),
  ).rejects.toThrow(/Doppelter/);
  await expect(
    codec.read(rawZip([{name: 'manifest.json', data, attrs: 0xa1ff0000}]), signal()),
  ).rejects.toThrow(/Symlink/);
  const encrypted = new Uint8Array(await rawZip([{name: 'manifest.json', data}]).arrayBuffer());
  encrypted[6] = 1;
  await expect(codec.read(new Blob([encrypted]), signal())).rejects.toThrow();
  const prepended = new Blob([
    new Uint8Array([1]),
    await rawZip([{name: 'manifest.json', data}]).arrayBuffer(),
  ]);
  await expect(codec.read(prepended, signal())).rejects.toThrow();
});
it('AT-060: actual streaming expansion, ratio, entry/count/total/compressed budgets are enforced', async () => {
  const large = new Uint8Array(2 * 1024 * 1024);
  await expect(
    codec.read(rawZip([{name: 'manifest.json', data: large, method: 8}]), signal()),
  ).rejects.toThrow(/Expansion/);
  await expect(
    codec.read(rawZip([{name: 'manifest.json', data: large, method: 8, size: 100}]), signal()),
  ).rejects.toThrow(/Tatsächliche ZIP-Expansion/);
  for (const limits of [{entryBytes: 1}, {expandedBytes: 1}, {compressedBytes: 1}, {entries: 0}])
    await expect(
      new ZipArchiveCodec({...archiveDefaults, ...limits}).read(
        rawZip([{name: 'manifest.json', data}]),
        signal(),
      ),
    ).rejects.toThrow();
});
it('AT-064/061: all hashes and runtime fields checked before publication, create failure leaves original intact', async () => {
  const repository = new MemoryWorkspaceRepository(),
    artifacts = new MemoryArtifactStore(134217728);
  const original = await repository.create(
    emptyWorkspace(checkedId(crypto.randomUUID()), 'Original', new Date().toISOString()),
  );
  const artifact = await artifacts.write(
    original.workspace.id,
    new Blob(['bytes']).stream(),
    'application/octet-stream',
    signal(),
  );
  original.artifacts[artifact.id] = artifact;
  const archive = new WorkspaceArchive({
    codec,
    repository,
    artifacts,
    newId: () => checkedId(crypto.randomUUID()),
    now: () => new Date().toISOString(),
    lock: {
      acquire: async (workspaceId) => ({workspaceId, mode: 'writer', release: async () => {}}),
    },
  });
  const exported = await archive.export(original, 'with-data', false, signal());
  const files = await codec.read(exported.blob, signal());
  const entry = exported.manifest.files[0]!.entry;
  files.set(entry, new TextEncoder().encode('other'));
  await expect(archive.inspect(await codec.write(files, signal()), signal())).rejects.toMatchObject(
    {code: 'ARCHIVE_INVALID'},
  );
  const unsafe = {...exported.manifest, runtimeConfig: {evil: 'https://example.invalid'}};
  files.set(entry, new TextEncoder().encode('bytes'));
  files.set('manifest.json', new TextEncoder().encode(JSON.stringify(unsafe)));
  await expect(archive.inspect(await codec.write(files, signal()), signal())).rejects.toMatchObject(
    {code: 'ARCHIVE_INVALID'},
  );
  const candidate = await archive.inspect(exported.blob, signal());
  const extra = await codec.read(exported.blob, signal());
  extra.set(`artifacts/${crypto.randomUUID()}.bin`, data);
  await expect(archive.inspect(await codec.write(extra, signal()), signal())).rejects.toThrow(
    'Nicht manifestierte Datei',
  );
  const retryCandidate = await archive.inspect(exported.blob, signal());
  expect(retryCandidate.id).not.toBe(candidate.id);
  repository.create = async () => {
    throw Error('injected metadata failure');
  };
  await expect(archive.commitImport(retryCandidate.id, signal())).rejects.toThrow(
    'injected metadata failure',
  );
  expect(await repository.list()).toHaveLength(1);
  const ids = [];
  for await (const id of artifacts.listWorkspaceIds()) ids.push(id);
  expect(ids).toHaveLength(2);
});
it('AT-063: failed file cleanup reports leftovers after metadata removal and can recover without touching the second workspace', async () => {
  const repository = new MemoryWorkspaceRepository(),
    artifacts = new MemoryArtifactStore(1024),
    lock = {
      acquire: async (workspaceId: import('../../src/domain/model').WorkspaceId) => ({
        workspaceId,
        mode: 'writer' as const,
        release: async () => {},
      }),
    },
    service = new WorkspaceService({
      repository,
      artifacts,
      lock,
      newId: () => checkedId(crypto.randomUUID()),
      now: () => new Date().toISOString(),
    });
  const first = await service.create('Zu löschen'),
    second = await service.create('Bleibt');
  const a = await artifacts.write(
      first.workspace.id,
      new Blob(['A']).stream(),
      'text/plain',
      signal(),
    ),
    b = await artifacts.write(
      second.workspace.id,
      new Blob(['B']).stream(),
      'text/plain',
      signal(),
    );
  await expect(service.deleteWorkspace(first.workspace.id, 99)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  });
  expect(await artifacts.exists(a)).toBe(true);
  const listing = vi.spyOn(artifacts, 'list').mockImplementationOnce(async function* () {
    throw Error('directory inaccessible');
  });
  expect(await service.deleteWorkspace(first.workspace.id, first.revision)).toEqual([
    `workspaces/${first.workspace.id}: Error: directory inaccessible`,
  ]);
  listing.mockRestore();
  expect(await repository.load(first.workspace.id)).toBeUndefined();
  expect(await repository.load(second.workspace.id)).toEqual(second);
  expect(await artifacts.exists(a)).toBe(true);
  const report = await new RecoveryService(artifacts).cleanAbandoned(repository, lock, signal());
  expect(report).toEqual({removed: [a.path], failures: []});
  expect(await artifacts.verify(b, signal())).toBe('valid');
  await service.close();
});
it('AT-064: duplicate import commits are rejected while the first waits for its exclusive lease', async () => {
  const repository = new MemoryWorkspaceRepository(),
    artifacts = new MemoryArtifactStore(1024);
  let unlock: (() => void) | undefined;
  const archive = new WorkspaceArchive({
    codec,
    repository,
    artifacts,
    newId: () => checkedId(crypto.randomUUID()),
    now: () => new Date().toISOString(),
    lock: {
      acquire: async (workspaceId) => {
        await new Promise<void>((resolve) => {
          unlock = resolve;
        });
        return {workspaceId, mode: 'writer', release: async () => {}};
      },
    },
  });
  const file = new Blob([new Uint8Array(await readFile('fixtures/sample.dwproj'))]),
    candidate = await archive.inspect(file, signal()),
    first = archive.commitImport(candidate.id, signal());
  await expect(archive.commitImport(candidate.id, signal())).rejects.toThrow('läuft bereits');
  await expect(archive.inspect(file, signal())).rejects.toThrow('läuft bereits');
  unlock!();
  await first;
  expect(await repository.list()).toHaveLength(1);
});
