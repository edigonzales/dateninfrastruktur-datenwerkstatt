import type {ArtifactStore} from './ports';
import type {WorkspaceId} from '../domain/model';
export interface ManagedArtifactStore extends ArtifactStore {
  listWorkspaceIds(): AsyncIterable<WorkspaceId>;
  /** Only application-generated paths, called under writer lease with no active write jobs. */
  deleteUnreferenced(workspaceId: WorkspaceId, path: string): Promise<void>;
}
