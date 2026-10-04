import {z} from 'zod';
import type {WorkspaceViewState, WorkspaceId} from '../../domain/model';
import type {WorkspaceDatabase} from './workspaceRepository';
const schema = z.strictObject({
  workspaceId: z.uuid(),
  activeAnalysisId: z.uuid().optional(),
  openAnalysisIds: z.array(z.uuid()),
  sidebarCollapsed: z.boolean(),
  dataPanelVisible: z.boolean(),
  sqlEditorFraction: z.number().min(0.15).max(0.8),
  rEditorFraction: z.number().min(0.15).max(0.8),
  rConsoleFraction: z.number().min(0.1).max(0.8),
  rConsoleVisible: z.boolean().default(true),
  rObjectsVisible: z.boolean().default(true),
});
export const defaultView = (workspaceId: WorkspaceId): WorkspaceViewState => ({
  workspaceId,
  openAnalysisIds: [],
  sidebarCollapsed: true,
  dataPanelVisible: false,
  sqlEditorFraction: 0.45,
  rEditorFraction: 0.5,
  rConsoleFraction: 0.25,
  rConsoleVisible: true,
  rObjectsVisible: true,
});
export interface ViewRepository {
  load(id: WorkspaceId, sidebarCollapsed?: boolean): Promise<WorkspaceViewState>;
  save(view: WorkspaceViewState): Promise<void>;
}
export class WorkspaceViewRepository implements ViewRepository {
  constructor(private readonly db: WorkspaceDatabase) {}
  async load(id: WorkspaceId, sidebarCollapsed = true) {
    const row = await this.db.workspaceViews.get(id);
    return row
      ? (schema.parse(row.value) as WorkspaceViewState)
      : {...defaultView(id), sidebarCollapsed};
  }
  async save(view: WorkspaceViewState) {
    const checked = schema.parse(view);
    await this.db.workspaceViews.put({workspaceId: checked.workspaceId, value: checked});
  }
}
export class MemoryViewRepository implements ViewRepository {
  private views = new Map<WorkspaceId, WorkspaceViewState>();
  async load(id: WorkspaceId, sidebarCollapsed = true) {
    return structuredClone(this.views.get(id) ?? {...defaultView(id), sidebarCollapsed});
  }
  async save(view: WorkspaceViewState) {
    schema.parse(view);
    this.views.set(view.workspaceId, structuredClone(view));
  }
}
