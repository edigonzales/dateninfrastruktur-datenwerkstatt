import {measure} from './diagnostics';
import type {WorkspaceDocument} from '../domain/model';
import {parseWorkspace} from '../domain/workspace';
import type {WorkspaceRepository} from './ports';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export class PersistenceCoordinator {
  document: WorkspaceDocument;
  generation = 0;
  savedGeneration = 0;
  state: SaveState = 'saved';
  error: unknown;
  private pending: Promise<void> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private maximum: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  constructor(
    document: WorkspaceDocument,
    private readonly repository: WorkspaceRepository,
  ) {
    this.document = document;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  mutate(edit: (document: WorkspaceDocument) => void) {
    const next = structuredClone(this.document);
    edit(next);
    this.document = parseWorkspace(next);
    this.generation++;
    this.state = 'dirty';
    this.emit();
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 600);
    this.maximum ??= setTimeout(() => {
      void this.flush().catch(() => {});
    }, 3000);
  }
  async flush(): Promise<void> {
    this.clearTimers();
    if (this.pending) {
      await this.pending;
      if (this.savedGeneration < this.generation) return this.flush();
      return;
    }
    if (this.savedGeneration === this.generation) return;
    const generation = this.generation;
    const snapshot = structuredClone(this.document);
    this.state = 'saving';
    this.error = undefined;
    this.emit();
    this.pending = (async () => {
      try {
        const saved = await measure('Metadaten speichern', () =>
          this.repository.commit(snapshot, snapshot.revision),
        );
        // Never replace the live document with an older snapshot.
        this.document = {...this.document, revision: saved.revision};
        this.savedGeneration = generation;
        this.state = this.generation === generation ? 'saved' : 'dirty';
      } catch (error) {
        this.error = error;
        this.state = 'error';
        throw error;
      } finally {
        this.pending = undefined;
        this.emit();
      }
    })();
    await this.pending;
    if (this.savedGeneration < this.generation) return this.flush();
  }
  private publication: Promise<void> = Promise.resolve();
  /** File work precedes this call. The candidate stays invisible until CAS succeeds. */
  publish(change: (document: WorkspaceDocument) => void): Promise<void> {
    const operation = this.publication.then(async () => {
      await this.flush();
      const generation = this.generation;
      const candidate = structuredClone(this.document);
      change(candidate);
      const checked = parseWorkspace(candidate);
      this.state = 'saving';
      this.error = undefined;
      this.emit();
      this.pending = (async () => {
        try {
          const saved = await measure('Metadaten veröffentlichen', () =>
            this.repository.commit(checked, checked.revision),
          );
          // Apply the same isolated addition to newer editor changes, never replace them.
          const current = structuredClone(this.document);
          change(current);
          current.revision = saved.revision;
          this.document = parseWorkspace(current);
          this.generation++;
          this.savedGeneration = generation + 1;
          this.state = this.generation === this.savedGeneration ? 'saved' : 'dirty';
        } catch (error) {
          this.error = error;
          this.state = 'error';
          throw error;
        } finally {
          this.pending = undefined;
          this.emit();
        }
      })();
      await this.pending;
    });
    this.publication = operation.catch(() => {});
    return operation;
  }
  acknowledgeUnpublishedFailure() {
    // A failed publication left the prior document intact; acknowledging never publishes it.
    if (this.state === 'error' && this.savedGeneration === this.generation) {
      this.error = undefined;
      this.state = 'saved';
      this.emit();
    }
  }
  stopTimers() {
    this.clearTimers();
  }
  private clearTimers() {
    clearTimeout(this.debounce);
    clearTimeout(this.maximum);
    this.debounce = undefined;
    this.maximum = undefined;
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
}
