import {describe, expect, it, vi} from 'vitest';
import type {DuckDbConnector} from '@sqlrooms/duckdb';
import {executeDuckDbQuery} from './executeDuckDbQuery';

describe('executeDuckDbQuery', () => {
  it('cancels a Wasm query once and waits for the query before resolving cancel', async () => {
    let resolveQuery!: () => void;
    let resolveCancel!: () => void;
    const query = new Promise<void>((resolve) => {
      resolveQuery = resolve;
    });
    const cancelSent = new Promise<void>((resolve) => {
      resolveCancel = resolve;
    });
    const connection = {
      query: vi.fn().mockReturnValue(query),
      cancelSent: vi.fn().mockReturnValue(cancelSent)
    };
    const handle = executeDuckDbQuery(wasmConnector(connection), 'SELECT 1');

    const firstCancel = handle.cancel();
    const secondCancel = handle.cancel();

    expect(firstCancel).toBe(secondCancel);
    expect(connection.cancelSent).toHaveBeenCalledTimes(1);
    resolveCancel();

    let cancelSettled = false;
    void firstCancel.then(() => {
      cancelSettled = true;
    });
    await Promise.resolve();
    expect(cancelSettled).toBe(false);

    resolveQuery();
    await firstCancel;
    await expect(handle).rejects.toMatchObject({name: 'AbortError'});
  });

  it('aborts through the external signal but waits for the original query', async () => {
    let resolveQuery!: () => void;
    const query = new Promise<void>((resolve) => {
      resolveQuery = resolve;
    });
    const connection = {
      query: vi.fn().mockReturnValue(query),
      cancelSent: vi.fn().mockResolvedValue(undefined)
    };
    const controller = new AbortController();
    const handle = executeDuckDbQuery(wasmConnector(connection), 'SELECT 1', {signal: controller.signal});
    const result = handle.then(
      () => 'resolved',
      (error: Error) => error.name
    );

    controller.abort();
    expect(connection.cancelSent).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(await Promise.race([result, Promise.resolve('still-running')])).toBe('still-running');

    resolveQuery();
    await expect(result).resolves.toBe('AbortError');
  });

  it('keeps a normal query error distinct from cancellation', async () => {
    const failure = new Error('SQL failed');
    const connection = {
      query: vi.fn().mockRejectedValue(failure),
      cancelSent: vi.fn().mockResolvedValue(undefined)
    };
    const handle = executeDuckDbQuery(wasmConnector(connection), 'SELECT 1');

    await expect(handle).rejects.toBe(failure);
    expect(connection.cancelSent).not.toHaveBeenCalled();
  });

  it('waits for the query even when cancelSent fails', async () => {
    let resolveQuery!: () => void;
    const query = new Promise<void>((resolve) => {
      resolveQuery = resolve;
    });
    const connection = {
      query: vi.fn().mockReturnValue(query),
      cancelSent: vi.fn().mockRejectedValue(new Error('cancel failed'))
    };
    const handle = executeDuckDbQuery(wasmConnector(connection), 'SELECT 1');
    const cancel = handle.cancel();

    let settled = false;
    void cancel.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveQuery();
    await expect(cancel).resolves.toBeUndefined();
    await expect(handle).rejects.toMatchObject({name: 'AbortError'});
  });
});

function wasmConnector(connection: {query: ReturnType<typeof vi.fn>; cancelSent: ReturnType<typeof vi.fn>}): DuckDbConnector {
  return {
    type: 'wasm',
    getConnection: () => connection
  } as unknown as DuckDbConnector;
}
