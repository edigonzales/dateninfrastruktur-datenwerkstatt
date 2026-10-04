import {measure} from './diagnostics';
import {AppFailure} from './errors';
/** One executing/mutating operation per workspace; repeated clicks never queue jobs. */
export class WorkspaceScheduler {
  private active: {label: string; controller: AbortController; done: Promise<unknown>} | undefined;
  private closed = false;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.active?.label ?? null;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit() {
    for (const fn of this.listeners) fn();
  }
  run<T>(
    label: string,
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new AppFailure('RUNTIME_RESET', 'Sitzung geschlossen.'));
    if (this.active)
      return Promise.reject(
        new AppFailure(
          'VALIDATION_FAILED',
          'Eine Operation läuft bereits. Bitte abschliessen oder abbrechen.',
        ),
      );
    const controller = new AbortController();
    const joined = AbortSignal.any([controller.signal, signal]);
    const done = Promise.resolve().then(() => {
      joined.throwIfAborted();
      return measure(label, () => work(joined));
    });
    this.active = {label, controller, done};
    this.emit();
    void done
      .finally(() => {
        this.active = undefined;
        this.emit();
      })
      .catch(() => {});
    return done;
  }
  cancel() {
    this.active?.controller.abort();
  }
  async close() {
    this.closed = true;
    this.cancel();
    await this.active?.done.catch(() => {});
  }
}
