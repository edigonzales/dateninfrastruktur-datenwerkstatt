import {expect, test} from '@playwright/test';
import {isolateOpfs} from '../isolateOpfs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('AT-007 AT-012: actual IndexedDB CAS, invalid load, transaction rollback', async ({page}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async () => {
    const repoPath = '/src/infrastructure/storage/workspaceRepository.ts';
    const domainPath = '/src/domain/workspace.ts';
    const {
      DexieWorkspaceRepository,
      WorkspaceDatabase,
    }: typeof import('../../src/infrastructure/storage/workspaceRepository') = await import(
      repoPath
    );
    const {emptyWorkspace, checkedId}: typeof import('../../src/domain/workspace') = await import(
      domainPath
    );
    const db = new WorkspaceDatabase(`test-${crypto.randomUUID()}`);
    const repo = new DexieWorkspaceRepository(db);
    const original = emptyWorkspace(
      checkedId<'workspace'>(crypto.randomUUID()),
      'Initial',
      '2026-10-03T12:00:00Z',
    );
    try {
      await repo.create(original);
      const first = {...original, workspace: {...original.workspace, name: 'First'}};
      await repo.commit(first, 0);
      let conflict = false;
      try {
        await repo.commit({...original, workspace: {...original.workspace, name: 'Stale'}}, 0);
      } catch {
        conflict = true;
      }
      const afterConflict = await repo.load(original.workspace.id);
      let rollback = false;
      try {
        await db.transaction('rw', db.workspaces, async () => {
          await db.workspaces.put({
            id: original.workspace.id,
            name: 'bad',
            updatedAt: original.workspace.updatedAt,
            document: {...original, formatVersion: 99},
          });
          throw Error('migration fault');
        });
      } catch {
        rollback = true;
      }
      const afterRollback = await repo.load(original.workspace.id);
      await db.workspaces.update(original.workspace.id, {
        document: {...original, formatVersion: 99},
      });
      let invalid = false;
      try {
        await repo.load(original.workspace.id);
      } catch {
        invalid = true;
      }
      const unchanged = (await db.workspaces.get(original.workspace.id))?.document;
      return {conflict, rollback, invalid, afterConflict, afterRollback, unchanged};
    } finally {
      await db.delete();
    }
  });
  expect(result.conflict).toBe(true);
  expect(result.rollback).toBe(true);
  expect(result.invalid).toBe(true);
  expect(result.afterConflict?.workspace.name).toBe('First');
  expect(result.afterConflict?.revision).toBe(1);
  expect(result.afterRollback).toEqual(result.afterConflict);
  expect(result.unchanged).toMatchObject({formatVersion: 99});
});
test('P0: persistent browser profile OPFS read/write/delete', async ({playwright, browserName}) => {
  const profile = await mkdtemp(join(tmpdir(), 'datenwerkstatt-opfs-'));
  const context = await playwright[browserName].launchPersistentContext(profile, {headless: true});
  const cleanup = await isolateOpfs(context);
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4173/tests/spike/index.html');
    const result = await page.evaluate(async () => {
      const path = '/tests/spike/probe.ts';
      const probe: typeof import('../spike/probe') = await import(path);
      return probe.storageSmoke();
    });
    expect(result).toEqual({bytes: [0, 1, 255], revision: 1, locks: true});
  } finally {
    try {
      await cleanup();
    } finally {
      await context.close();
      await rm(profile, {recursive: true, force: true});
    }
  }
});
