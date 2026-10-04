import Dexie, {type EntityTable} from 'dexie';
import {parseWorkspace} from '../../domain/workspace';
import {assertImmutableHistory} from '../../domain/immutability';
import type {WorkspaceDocument, WorkspaceId, WorkspaceSummary} from '../../domain/model';
import type {WorkspaceRepository} from '../../application/ports';
import {AppFailure} from '../../application/errors';
interface WorkspaceRow {
  id: string;
  name: string;
  updatedAt: string;
  document: unknown;
}
export class WorkspaceDatabase extends Dexie {
  workspaces!: EntityTable<WorkspaceRow, 'id'>;
  workspaceViews!: EntityTable<{workspaceId: string; value: unknown}, 'workspaceId'>;
  appSettings!: EntityTable<{id: string; value: unknown}, 'id'>;
  constructor(name = 'datenwerkstatt-v1') {
    super(name);
    this.version(1).stores({
      workspaces: 'id,updatedAt,name',
      workspaceViews: 'workspaceId',
      appSettings: 'id',
    });
  }
}
export class DexieWorkspaceRepository implements WorkspaceRepository {
  constructor(readonly db = new WorkspaceDatabase()) {}
  async list(): Promise<WorkspaceSummary[]> {
    return (await this.db.workspaces.orderBy('updatedAt').reverse().toArray()).map((row) => {
      const d = parseWorkspace(row.document);
      return {
        id: d.workspace.id,
        name: d.workspace.name,
        updatedAt: d.workspace.updatedAt,
        datasetCount: Object.values(d.datasets).filter((ds) => !ds.removedAt).length,
        analysisCount: Object.values(d.analyses).filter((a) => !a.archivedAt).length,
      };
    });
  }
  async load(id: WorkspaceId) {
    const row = await this.db.workspaces.get(id);
    return row ? parseWorkspace(row.document) : undefined;
  }
  async create(document: WorkspaceDocument) {
    const d = parseWorkspace(document);
    if (d.revision !== 0)
      throw new AppFailure('REVISION_CONFLICT', 'Ein neues Projekt muss Revision 0 haben.');
    await this.db.workspaces.add(this.row(d));
    return d;
  }
  async commit(document: WorkspaceDocument, expectedRevision: number) {
    const d = parseWorkspace(document);
    return this.db.transaction('rw', this.db.workspaces, async () => {
      const before = await this.load(d.workspace.id);
      if (!before || before.revision !== expectedRevision || d.revision !== expectedRevision)
        throw new AppFailure(
          'REVISION_CONFLICT',
          'Das Projekt wurde in einer anderen Sitzung geändert. Bitte neu laden.',
        );
      assertImmutableHistory(before, d);
      const saved = {...d, revision: expectedRevision + 1};
      await this.db.workspaces.put(this.row(saved));
      return saved;
    });
  }
  async remove(id: WorkspaceId, expectedRevision: number) {
    await this.db.transaction('rw', [this.db.workspaces, this.db.workspaceViews], async () => {
      const before = await this.load(id);
      if (!before || before.revision !== expectedRevision)
        throw new AppFailure('REVISION_CONFLICT', 'Projektstand hat sich geändert.');
      await this.db.workspaces.delete(id);
      await this.db.workspaceViews.delete(id);
    });
  }
  private row(d: WorkspaceDocument): WorkspaceRow {
    return {
      id: d.workspace.id,
      name: d.workspace.name,
      updatedAt: d.workspace.updatedAt,
      document: d,
    };
  }
}
