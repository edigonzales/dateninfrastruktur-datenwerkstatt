import type {WorkspaceDocument, WorkspaceId} from '../../domain/model';
import type {WorkspaceRepository} from '../../application/ports';
import {parseWorkspace} from '../../domain/workspace';
import {assertImmutableHistory} from '../../domain/immutability';
import {AppFailure} from '../../application/errors';
/** Explicit session-only persistence; never substitutes for failed durable commits. */
export class MemoryWorkspaceRepository implements WorkspaceRepository {
  private documents = new Map<WorkspaceId, WorkspaceDocument>();
  async list() {
    return [...this.documents.values()].map((d) => ({
      id: d.workspace.id,
      name: d.workspace.name,
      updatedAt: d.workspace.updatedAt,
      datasetCount: Object.values(d.datasets).filter((x) => !x.removedAt).length,
      analysisCount: Object.values(d.analyses).filter((x) => !x.archivedAt).length,
    }));
  }
  async load(id: WorkspaceId) {
    const d = this.documents.get(id);
    return d ? parseWorkspace(structuredClone(d)) : undefined;
  }
  async create(document: WorkspaceDocument) {
    const d = parseWorkspace(structuredClone(document));
    if (d.revision !== 0 || this.documents.has(d.workspace.id))
      throw new AppFailure('REVISION_CONFLICT', 'Projekt existiert bereits.');
    this.documents.set(d.workspace.id, d);
    return structuredClone(d);
  }
  async commit(document: WorkspaceDocument, expectedRevision: number) {
    const d = parseWorkspace(structuredClone(document));
    const before = this.documents.get(d.workspace.id);
    if (!before || before.revision !== expectedRevision || d.revision !== expectedRevision)
      throw new AppFailure('REVISION_CONFLICT', 'Sitzungsstand wurde inzwischen geändert.');
    assertImmutableHistory(before, d);
    const saved = {...d, revision: expectedRevision + 1};
    this.documents.set(d.workspace.id, saved);
    return structuredClone(saved);
  }
  async remove(id: WorkspaceId, expectedRevision: number) {
    if (this.documents.get(id)?.revision !== expectedRevision)
      throw new AppFailure('REVISION_CONFLICT', 'Projektstand hat sich geändert.');
    this.documents.delete(id);
  }
}
