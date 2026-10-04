import {expect, test} from '../persistentBrowser';

test.beforeEach(async ({page}) => {
  await page.goto('/tests/spike/index.html');
});
test('P0 / AT-001 AT-002: one connector, Arrow, CSV → Parquet and stable materialization', async ({
  page,
}, info) => {
  const result = await page.evaluate(async () => {
    const path = '/tests/spike/probe.ts';
    const probe: typeof import('../spike/probe') = await import(path);
    try {
      return await probe.sqlSmoke();
    } catch (error) {
      throw new Error(String(error) + JSON.stringify(error));
    } finally {
      await probe.close();
    }
  });
  expect(result.initializationCount).toBe(1);
  expect(result.rows).toEqual([
    {id: '001', wert: 4},
    {id: '002', wert: 7},
  ]);
  expect(result.bytes).toBeGreaterThan(100);
  expect(result.stableRows).toBe(350);
  expect(result.stable).toBe(true);
  await info.attach('duckdb-proof', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
test('P0: DuckDB parser returns SELECT AST and rejects non-SELECT serialization', async ({
  page,
}, info) => {
  const results = await page.evaluate(async () => {
    const path = '/tests/spike/probe.ts';
    const probe: typeof import('../spike/probe') = await import(path);
    const corpus = [
      "SELECT ';' AS s",
      'WITH t AS (SELECT 1 AS a) SELECT * FROM t',
      'SELECT 1; SELECT 2',
      "COPY (SELECT 1) TO 'x.csv'",
      "SELECT * FROM read_csv('https://evil.invalid/data.csv')",
      "ATTACH 'x.db'",
    ];
    const results: {code: string; ast: unknown}[] = [];
    try {
      for (const code of corpus) {
        try {
          results.push({code, ast: await probe.parseSql(code)});
        } catch (error) {
          results.push({code, ast: {failure: String(error)}});
        }
      }
      return results;
    } catch (error) {
      throw new Error(String(error) + JSON.stringify(error));
    } finally {
      await probe.close();
    }
  });
  await info.attach('parser-AST-corpus', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  expect(results[0]?.ast).toMatchObject({error: false});
  expect(results[1]?.ast).toMatchObject({error: false});
  expect(results[2]?.ast).toMatchObject({error: false, statements: [{}, {}]});
  expect(results[3]?.ast).toMatchObject({error: true});
  expect(results[5]?.ast).toMatchObject({error: true});
});
test('P0 / AT-030: running SQL ends or worker terminates, fresh query works', async ({
  page,
}, info) => {
  let closedWorkers = 0;
  page.on('worker', (worker) =>
    worker.on('close', () => {
      closedWorkers++;
    }),
  );
  const result = await page.evaluate(async () => {
    const path = '/tests/spike/probe.ts';
    const probe: typeof import('../spike/probe') = await import(path);
    try {
      return await probe.sqlCancel();
    } catch (error) {
      throw new Error(String(error) + JSON.stringify(error));
    } finally {
      await probe.close();
    }
  });
  expect(result.wasRunning).toBe(true);
  expect(result.settled || result.neededReset).toBe(true);
  expect(result.fresh.rows).toEqual([{wert: 7}]);
  await expect.poll(() => closedWorkers).toBeGreaterThanOrEqual(1);
  await info.attach('SQL-stop', {
    body: JSON.stringify({...result, closedWorkers}),
    contentType: 'application/json',
  });
});
test('P0 / AT-046: local webR dataframe, real plot, PostMessage worker reset', async ({
  page,
}, info) => {
  let closedWorkers = 0;
  page.on('worker', (worker) =>
    worker.on('close', () => {
      closedWorkers++;
    }),
  );
  const result = await page.evaluate(async () => {
    const path = '/tests/spike/probe.ts';
    const probe: typeof import('../spike/probe') = await import(path);
    try {
      return {smoke: await probe.rSmoke(), cancel: await probe.rCancel()};
    } catch (error) {
      throw new Error(String(error) + JSON.stringify(error));
    } finally {
      await probe.close();
    }
  });
  expect(result.smoke.sum).toBe(11);
  // webR canvas uses two physical pixels per logical plotting pixel.
  expect(result.smoke.images).toHaveLength(1);
  expect(result.smoke.images[0]).toMatchObject({width: 800, height: 600});
  expect(result.smoke.images[0]?.ink).toBeGreaterThan(100);
  expect(result.cancel.wasRunning).toBe(true);
  expect(result.cancel.epoch).toBe(1);
  expect(result.cancel.result).toBe(3);
  await expect.poll(() => closedWorkers).toBeGreaterThanOrEqual(1);
  await info.attach('webR-proof', {
    body: JSON.stringify({...result, closedWorkers}),
    contentType: 'application/json',
  });
});
test('P0: real OPFS read/write/delete and IndexedDB transaction', async ({page}) => {
  const result = await page.evaluate(async () => {
    const path = '/tests/spike/probe.ts';
    const probe: typeof import('../spike/probe') = await import(path);
    return probe.storageSmoke();
  });
  expect(result).toEqual({bytes: [0, 1, 255], revision: 1, locks: true});
});
test('P0 / AT-012: Web Lock callback holds writer lease across tabs', async ({page, context}) => {
  const other = await context.newPage();
  await other.goto('/tests/spike/index.html');
  const acquire = async (target: typeof page) =>
    target.evaluate(async () => {
      const path = '/tests/spike/probe.ts';
      const probe: typeof import('../spike/probe') = await import(path);
      return probe.acquireLock('p0-workspace');
    });
  expect(await acquire(page)).toBe(true);
  expect(await acquire(other)).toBe(false);
  await page.close();
  await expect.poll(() => acquire(other)).toBe(true);
  await other.close();
});

test('P0 / AT-023: guard allows analysis and blocks external/dynamic SQL without execution', async ({
  page,
}) => {
  const outcome = await page.evaluate(async () => {
    const path = '/tests/spike/probe.ts';
    const probe: typeof import('../spike/probe') = await import(path);
    const allowed = [
      "-- comment\nSELECT ';' AS s",
      'WITH t AS (SELECT 1 AS a) SELECT a FROM t',
      'SELECT sum(i), avg(i) FROM range(12) t(i)',
      'SELECT 1 UNION SELECT 2',
    ];
    const blocked = [
      'SELECT 1; SELECT 2',
      "COPY (SELECT 1) TO 'x.csv'",
      "ATTACH 'x.db'",
      "SELECT * FROM read_csv('https://evil.invalid')",
      "SELECT * FROM query('SELECT 1')",
      "SELECT * FROM 'x.parquet'",
      'SELECT * FROM information_schema.tables',
    ];
    try {
      const good: boolean[] = [];
      const bad: boolean[] = [];
      for (const code of allowed) good.push(await probe.guarded(code));
      for (const code of blocked) {
        try {
          await probe.guarded(code);
          bad.push(false);
        } catch {
          bad.push(true);
        }
      }
      return {good, bad};
    } finally {
      await probe.close();
    }
  });
  expect(outcome.good).toEqual([true, true, true, true]);
  expect(outcome.bad).toEqual([true, true, true, true, true, true, true]);
});
