import type {WorkspaceId} from '../../domain/model';
import type {WorkspaceLock, WorkspaceLease} from '../../application/ports';
export class BrowserWorkspaceLock implements WorkspaceLock {
  async acquire(workspaceId: WorkspaceId, signal: AbortSignal): Promise<WorkspaceLease> {
    signal.throwIfAborted();
    if (!navigator.locks) return {workspaceId, mode: 'reader', release: async () => {}};
    return new Promise((resolve, reject) => {
      let released = false;
      let release: () => void = () => {};
      const hold = new Promise<void>((r) => {
        release = r;
      });
      const task = navigator.locks.request(
        `datenwerkstatt:${workspaceId}`,
        {mode: 'exclusive', ifAvailable: true},
        async (lock) => {
          if (signal.aborted) {
            release();
            reject(signal.reason);
            return;
          }
          const abort = () => {
            release();
          };
          signal.addEventListener('abort', abort, {once: true});
          resolve({
            workspaceId,
            mode: lock ? 'writer' : 'reader',
            release: async () => {
              if (!released) {
                released = true;
                release();
              }
              await task;
            },
          });
          try {
            if (lock) await hold;
          } finally {
            signal.removeEventListener('abort', abort);
          }
        },
      );
      void task.catch(reject);
    });
  }
}
