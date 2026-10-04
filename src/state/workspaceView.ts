import {createStore} from 'zustand/vanilla';
import type {WorkspaceId, WorkspaceViewState} from '../domain/model';
import {defaultView, type ViewRepository} from '../infrastructure/storage/viewState';
/** One UI truth per mounted workspace; ordered whole-record saves avoid lost layout patches. */
export class WorkspaceViewController {
  readonly store;
  private writes: Promise<void> = Promise.resolve();
  constructor(
    private readonly repository: ViewRepository,
    id: WorkspaceId,
    private readonly onError: (error: unknown) => void,
    private readonly sidebarCollapsed = true,
  ) {
    this.store = createStore(() => ({value: defaultView(id), ready: false}));
  }
  async load() {
    try {
      this.store.setState({
        value: await this.repository.load(
          this.store.getState().value.workspaceId,
          this.sidebarCollapsed,
        ),
        ready: true,
      });
    } catch (error) {
      this.onError(error);
      this.store.setState({ready: true});
    }
  }
  patch(patch: Partial<WorkspaceViewState>) {
    if (!this.store.getState().ready) return;
    const current = this.store.getState().value;
    if (
      Object.entries(patch).every(([key, value]) =>
        Object.is(current[key as keyof WorkspaceViewState], value),
      )
    )
      return;
    const value = {...current, ...patch};
    this.store.setState({value});
    this.writes = this.writes.then(() => this.repository.save(value)).catch(this.onError);
  }
  reset() {
    const value = this.store.getState().value;
    this.patch({
      ...defaultView(value.workspaceId),
      openAnalysisIds: value.openAnalysisIds,
      ...(value.activeAnalysisId ? {activeAnalysisId: value.activeAnalysisId} : {}),
    });
  }
  flush() {
    return this.writes;
  }
}
