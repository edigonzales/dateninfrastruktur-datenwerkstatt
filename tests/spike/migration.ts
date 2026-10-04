import Dexie from 'dexie';
import {emptyWorkspace, checkedId, parseWorkspace} from '../../src/domain/workspace';

/** Test-only predecessor database: no earlier production project format is claimed. */
export async function migrationProof() {
  const name = `dw-test-predecessor-${crypto.randomUUID()}`;
  const id = checkedId<'workspace'>(crypto.randomUUID());
  const predecessor = {id, oldName: 'Unveränderter Vorgänger', note: 'keep after rollback'};
  const old = () => {
    const db = new Dexie(name);
    db.version(1).stores({projects: 'id'});
    return db;
  };
  const target = (fail: boolean) => {
    const db = old();
    db.version(2)
      .stores({workspaces: 'id,updatedAt,name'})
      .upgrade(async (tx) => {
        const before: unknown = await tx.table('projects').get(id);
        if (
          !before ||
          typeof before !== 'object' ||
          !('oldName' in before) ||
          typeof before.oldName !== 'string'
        )
          throw Error('Unexpected test predecessor');
        const document = emptyWorkspace(id, before.oldName, '2026-10-04T00:00:00Z');
        await tx
          .table('workspaces')
          .put({
            id,
            name: document.workspace.name,
            updatedAt: document.workspace.updatedAt,
            document,
          });
        await tx.table('projects').delete(id);
        if (fail) throw Error('Injected test migration failure after both writes');
      });
    return db;
  };
  let db = old();
  try {
    await db.table('projects').add(predecessor);
    db.close();
    db = target(true);
    let error = '';
    try {
      await db.open();
    } catch (e) {
      error = String(e);
    }
    db.close();
    db = old();
    await db.open();
    const afterFailure: unknown = await db.table('projects').get(id);
    const versionAfterFailure = db.verno;
    const tablesAfterFailure = db.tables.map((t) => t.name);
    db.close();
    db = target(false);
    await db.open();
    const row: unknown = await db.table('workspaces').get(id);
    if (!row || typeof row !== 'object' || !('document' in row))
      throw Error('Migration result missing');
    const migrated = parseWorkspace(row.document);
    return {
      predecessor,
      afterFailure,
      versionAfterFailure,
      tablesAfterFailure,
      error,
      migrated,
      legacyCount: await db.table('projects').count(),
    };
  } finally {
    await db.delete();
  }
}
