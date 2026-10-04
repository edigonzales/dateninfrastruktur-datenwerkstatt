import {test, expect} from '../persistentBrowser';

test('AT-069: corrupt DuckDB WASM frees its actual worker before retry', async ({page}, info) => {
  const workers: {closed: boolean}[] = [];
  page.on('worker', (worker) => {
    const record = {closed: false};
    workers.push(record);
    worker.on('close', () => {
      record.closed = true;
    });
  });
  let broken = true;
  await page.route('**/vendor/duckdb/**/*.wasm', async (route) => {
    if (broken && route.request().method() === 'GET')
      await route.fulfill({contentType: 'application/wasm', body: 'corrupt WASM'});
    else await route.continue();
  });
  await page.goto('/tests/spike/');
  const failure = await page.evaluate(async () => {
    const path = '/src/infrastructure/sqlrooms/runtime.ts';
    const {DuckDbRuntime} = (await import(
      path
    )) as typeof import('../../src/infrastructure/sqlrooms/runtime');
    const runtime = new DuckDbRuntime(crypto.randomUUID(), 50, 5000);
    Reflect.set(globalThis, 'faultRuntime', runtime);
    try {
      await runtime.operation(new AbortController().signal, async () => {});
      return 'unexpected success';
    } catch (error) {
      return String(error);
    }
  });
  expect(failure).toContain('SQL-Initialisierung überschritt');
  await info.attach('failed-init-workers', {
    body: JSON.stringify({failure, workers}),
    contentType: 'application/json',
  });
  await expect.poll(() => workers.filter((w) => !w.closed).length).toBe(0);
  broken = false;
  const result = await page.evaluate(async () => {
    const runtime = Reflect.get(
      globalThis,
      'faultRuntime',
    ) as import('../../src/infrastructure/sqlrooms/runtime').DuckDbRuntime;
    return runtime.operation(new AbortController().signal, async (_room, connection) =>
      Number((await connection.query('SELECT 42 AS n')).getChildAt(0)!.get(0)),
    );
  });
  expect(result).toBe(42);
  expect(workers.filter((w) => !w.closed)).toHaveLength(1);
});
