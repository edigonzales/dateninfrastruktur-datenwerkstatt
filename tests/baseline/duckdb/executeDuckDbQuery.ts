import {isWasmDuckDbConnector, type DuckDbConnector, type QueryHandle, type QueryOptions} from '@sqlrooms/duckdb';
import type {Table} from 'apache-arrow';

export function executeDuckDbQuery(
  connector: DuckDbConnector,
  sql: string,
  options?: QueryOptions
): QueryHandle<Table> {
  if (!isWasmDuckDbConnector(connector)) {
    return connector.query(sql, options);
  }

  const connection = connector.getConnection();
  const controller = new AbortController();
  const queryPromise = Promise.resolve().then(() => connection.query(sql));
  let cancelPromise: Promise<void> | undefined;

  const cancel = () => {
    cancelPromise ??= (async () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
      try {
        await connection.cancelSent();
      } catch {
        // The original query still has to settle before cancellation completes.
      }
      await queryPromise.catch(() => undefined);
    })();
    return cancelPromise;
  };

  options?.signal?.addEventListener('abort', () => {
    void cancel();
  }, {once: true});
  if (options?.signal?.aborted) {
    void cancel();
  }

  const result = queryPromise.then(
    (table) => {
      if (controller.signal.aborted) {
        throw abortError();
      }
      return table;
    },
    (error: unknown) => {
      if (controller.signal.aborted) {
        throw abortError();
      }
      throw error;
    }
  );

  return {
    result,
    signal: controller.signal,
    cancel,
    then: result.then.bind(result),
    catch: result.catch.bind(result),
    finally: result.finally.bind(result)
  };
}

function abortError(): Error {
  const error = new Error('Query cancelled.');
  error.name = 'AbortError';
  return error;
}
