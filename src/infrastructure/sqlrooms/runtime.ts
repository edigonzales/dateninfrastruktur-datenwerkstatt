import type {AsyncDuckDBConnection} from '@duckdb/duckdb-wasm';
import {AppFailure} from '../../application/errors';
import {createWorkspaceRoom} from './room';

type Room = ReturnType<typeof createWorkspaceRoom>;
/** One session owns this queue and connector. All adapters share it. */
export class DuckDbRuntime {
  private room: Room | undefined;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private lifetime = new AbortController();
  private resets = new Set<() => void>();
  epoch = 0;
  constructor(
    readonly sessionId: string = crypto.randomUUID(),
    private readonly graceMs = 2000,
    private readonly initTimeoutMs = 30000,
  ) {}
  onReset(listener: () => void) {
    this.resets.add(listener);
    return () => {
      this.resets.delete(listener);
    };
  }
  isCurrent(room: Room) {
    return this.room === room;
  }
  operation<T>(
    signal: AbortSignal,
    work: (room: Room, connection: AsyncDuckDBConnection) => Promise<T>,
  ): Promise<T> {
    const initDeadline = new AbortController();
    const combined = AbortSignal.any([signal, this.lifetime.signal, initDeadline.signal]);
    const job = this.queue.then(async () => {
      combined.throwIfAborted();
      if (this.closed) throw new AppFailure('RUNTIME_RESET', 'Sitzung ist geschlossen.');
      const room = (this.room ??= createWorkspaceRoom());
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        let cancelling = false;
        let terminating = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const finish = (
          result: {ok: true; value: T} | {ok: false; error: unknown},
          stopped = false,
        ) => {
          if (terminating && !stopped) return;
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          combined.removeEventListener('abort', abort);
          if (
            !result.ok &&
            result.error instanceof AppFailure &&
            result.error.code === 'RUNTIME_RESET'
          )
            reject(result.error);
          else if (initDeadline.signal.aborted)
            reject(
              new AppFailure(
                'TIMEOUT',
                'SQL-Initialisierung überschritt das Laufzeitlimit; der Worker wurde beendet.',
                true,
              ),
            );
          else if (cancelling) reject(new AppFailure('CANCELLED', 'Berechnung wurde beendet.'));
          else if (result.ok) resolve(result.value);
          else reject(result.error);
        };
        const abort = () => {
          cancelling = true;
          // cancelSent is a best effort. Only settling or worker termination releases the queue.
          try {
            void room.connector
              .getConnection()
              .cancelSent()
              .catch(() => {});
          } catch {
            /* Initializing. */
          }
          timer = setTimeout(() => {
            if (settled) return;
            terminating = true;
            if (this.room === room) {
              this.room = undefined;
              this.epoch++;
              for (const listener of this.resets) listener();
            }
            void room.terminate().then(
              () =>
                finish(
                  {ok: false, error: new AppFailure('CANCELLED', 'SQL-Runtime beendet.')},
                  true,
                ),
              (error: unknown) => {
                this.closed = true;
                finish(
                  {
                    ok: false,
                    error: new AppFailure(
                      'RUNTIME_RESET',
                      `Worker konnte nicht beendet werden: ${String(error)}`,
                    ),
                  },
                  true,
                );
              },
            );
          }, this.graceMs);
        };
        combined.addEventListener('abort', abort, {once: true});
        void (async () => {
          const initTimer = setTimeout(() => initDeadline.abort(), this.initTimeoutMs);
          try {
            await room.initialize(combined);
          } finally {
            clearTimeout(initTimer);
          }
          combined.throwIfAborted();
          const connection = room.connector.getConnection();
          await connection.query("SET TimeZone='UTC'");
          combined.throwIfAborted();
          return work(room, connection);
        })().then(
          (value) => finish({ok: true, value}),
          (error) => finish({ok: false, error}),
        );
      });
    });
    this.queue = job.then(
      () => {},
      () => {},
    );
    return job;
  }
  async dispose() {
    this.closed = true;
    this.lifetime.abort();
    await this.queue;
    await this.room?.close();
    this.room = undefined;
    this.resets.clear();
  }
}
