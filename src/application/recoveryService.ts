import {AppFailure} from './errors';
import type {WorkspaceDocument, WorkspaceId} from '../domain/model';
import type {ArtifactReferenceCheck, WorkspaceLock, WorkspaceRepository} from './ports';
import type {ManagedArtifactStore} from './storagePorts';
export class RecoveryService {
  constructor(private readonly artifacts: ManagedArtifactStore) {}
  async inspect(
    doc: WorkspaceDocument,
    signal: AbortSignal,
    hashes = false,
  ): Promise<ArtifactReferenceCheck> {
    const report: ArtifactReferenceCheck = {
      referenced: [],
      missing: [],
      corrupt: [],
      orphanPaths: [],
    };
    const paths = new Set<string>();
    for (const a of Object.values(doc.artifacts)) {
      signal.throwIfAborted();
      report.referenced.push(a.id);
      paths.add(a.path);
      let state: 'valid' | 'missing' | 'corrupt';
      try {
        state = hashes
          ? await this.artifacts.verify(a, signal)
          : (await this.artifacts.exists(a))
            ? 'valid'
            : 'missing';
      } catch (error) {
        if (error instanceof AppFailure && error.code === 'ARTIFACT_CORRUPT') state = 'corrupt';
        else throw error;
      }
      if (state === 'missing') report.missing.push(a.id);
      if (state === 'corrupt') report.corrupt.push(a.id);
    }
    for await (const file of this.artifacts.list(doc.workspace.id))
      if (!paths.has(file.path)) report.orphanPaths.push(file.path);
    return report;
  }
  async cleanAbandoned(repository: WorkspaceRepository, lock: WorkspaceLock, signal: AbortSignal) {
    const removed: string[] = [],
      failures: string[] = [];
    for await (const id of this.artifacts.listWorkspaceIds()) {
      signal.throwIfAborted();
      const lease = await lock.acquire(id, signal);
      try {
        if (lease.mode !== 'writer' || (await repository.load(id))) continue;
        for await (const file of this.artifacts.list(id)) {
          signal.throwIfAborted();
          try {
            await this.artifacts.deleteUnreferenced(id, file.path);
            removed.push(file.path);
          } catch (e) {
            failures.push(`${file.path}: ${String(e)}`);
          }
        }
      } finally {
        await lease.release();
      }
    }
    return {removed, failures};
  }
  async removeFiles(id: WorkspaceId) {
    const failures: string[] = [];
    try {
      for await (const file of this.artifacts.list(id))
        try {
          await this.artifacts.deleteUnreferenced(id, file.path);
        } catch (e) {
          failures.push(`${file.path}: ${String(e)}`);
        }
    } catch (e) {
      failures.push(`workspaces/${id}: ${String(e)}`);
    }
    return failures;
  }
}
