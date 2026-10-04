import {test, expect} from '../persistentBrowser';
test('P3 / AT-031 AT-032: 350-row user Parquet export and a nonresponding cancel API', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async () => {
    const runtimePath = '/src/infrastructure/sqlrooms/runtime.ts';
    const enginePath = '/src/infrastructure/sqlrooms/sqlEngine.ts';
    const filePath = '/src/infrastructure/sqlrooms/fileImportEngine.ts';
    const domainPath = '/src/domain/workspace.ts';
    const {DuckDbRuntime} = (await import(
      runtimePath
    )) as typeof import('../../src/infrastructure/sqlrooms/runtime');
    const {SqlRoomsSqlEngine} = (await import(
      enginePath
    )) as typeof import('../../src/infrastructure/sqlrooms/sqlEngine');
    const {DuckDbFileImportEngine} = (await import(
      filePath
    )) as typeof import('../../src/infrastructure/sqlrooms/fileImportEngine');
    const {checkedId} = (await import(domainPath)) as typeof import('../../src/domain/workspace');
    const runtime = new DuckDbRuntime(crypto.randomUUID(), 50);
    const sql = new SqlRoomsSqlEngine(
      runtime,
      async () => {
        throw Error('No source expected');
      },
      'test',
    );
    const files = new DuckDbFileImportEngine(134217728, runtime);
    const signal = new AbortController().signal;
    const fingerprint = await sql.fingerprint();
    const execute = (code: string, signal: AbortSignal) =>
      sql.execute({
        runId: checkedId<'run'>(crypto.randomUUID()),
        signal,
        budget: {
          maxExecutionMs: 30000,
          maxResultRows: 100000,
          maxResultBytes: 67108864,
          maxTransferBytes: 67108864,
        },
        snapshot: {
          language: 'sql',
          code,
          parameters: {},
          resolvedInputs: [],
          inputScope: 'workspace-snapshot',
          runtime: fingerprint,
          provenance: 'declared-inputs',
          notes: [],
        },
      });
    try {
      const first = await execute('SELECT i, random() AS value FROM range(350) t(i)', signal);
      const full = await sql.readPage(first.table, {offset: 0, size: 500, sort: []}, signal);
      const data = await new Response(await sql.writeParquet(first.table, signal)).blob();
      const preview = await files.preview(
        new File([data], 'user.parquet'),
        'parquet',
        undefined,
        signal,
      );
      const imported = await files.prepare(preview.key, signal);
      const snapshot = await new Response(await sql.snapshotParquet(first.table, signal)).blob();
      let cancelCalls = 0;
      let queries = 0;
      let started!: () => void;
      const begun = new Promise<void>((resolve) => {
        started = resolve;
      });
      await runtime.operation(signal, async (_room, c) => {
        c.cancelSent = () => {
          cancelCalls++;
          return new Promise<boolean>(() => {});
        };
        const prepare = c.prepare.bind(c);
        c.prepare = async function <T extends Record<string, import('apache-arrow').DataType>>(
          code: string,
        ) {
          const stmt = await prepare<T>(code);
          const query = stmt.query.bind(stmt);
          stmt.query = (...params: unknown[]) => {
            const job = query(...params);
            if (code.startsWith('CREATE TEMP TABLE') && code.includes('100000000')) {
              queries++;
              started();
            }
            return job;
          };
          return stmt;
        };
      });
      const abort = new AbortController();
      const pending = execute(
        'SELECT sum(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i)',
        abort.signal,
      );
      const settled = pending.then(
        () => ({success: true, error: ''}),
        (e) => ({success: false, error: String(e)}),
      );
      await begun;
      await new Promise((resolve) => setTimeout(resolve, 50));
      abort.abort();
      const stopped = await settled;
      const epoch = runtime.epoch;
      let stale = '';
      try {
        await sql.readPage(first.table, {offset: 0, size: 100, sort: []}, signal);
      } catch (e) {
        stale = String(e);
      }
      const restored = await sql.restore(
        snapshot.stream(),
        first.table.schema,
        first.table.rowCount,
        signal,
      );
      const restoredAll = await sql.readPage(restored, {offset: 0, size: 500, sort: []}, signal);
      const next = await execute('SELECT 7 AS answer', signal);
      return {
        full,
        restoredAll,
        exportedRows: imported.rowCount,
        exportedColumns: imported.schema.columns.map((c) => c.name),
        cancelCalls,
        queries,
        stopped,
        epoch,
        stale,
        next: await sql.readPage(next.table, {offset: 0, size: 100, sort: []}, signal),
      };
    } finally {
      await sql.dispose();
    }
  });
  expect(result.exportedRows).toBe('350');
  expect(result.exportedColumns).toEqual(['i', 'value']);
  expect(result.full.rows).toHaveLength(350);
  expect(result.restoredAll).toEqual(result.full);
  expect(result.queries).toBe(1);
  expect(result.cancelCalls).toBe(1);
  expect(result.stopped.success).toBe(false);
  expect(result.epoch).toBe(1);
  expect(result.stale).toContain('SQL-Sitzung');
  expect(result.next.rows).toEqual([['7']]);
});

test('P3 / AT-030: cancellation after CTAS settling releases unpublished private relation', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const proof = await page.evaluate(async () => {
    const runtimePath = '/src/infrastructure/sqlrooms/runtime.ts',
      enginePath = '/src/infrastructure/sqlrooms/sqlEngine.ts',
      domainPath = '/src/domain/workspace.ts';
    const {DuckDbRuntime} = (await import(
      runtimePath
    )) as typeof import('../../src/infrastructure/sqlrooms/runtime');
    const {SqlRoomsSqlEngine} = (await import(
      enginePath
    )) as typeof import('../../src/infrastructure/sqlrooms/sqlEngine');
    const {checkedId} = (await import(domainPath)) as typeof import('../../src/domain/workspace');
    const runtime = new DuckDbRuntime();
    const sql = new SqlRoomsSqlEngine(
      runtime,
      async () => {
        throw Error('No dataset');
      },
      'test',
    );
    const controller = new AbortController();
    const signal = new AbortController().signal;
    try {
      const fingerprint = await sql.fingerprint();
      await runtime.operation(signal, async (_room, c) => {
        const prepare = c.prepare.bind(c);
        c.prepare = async function <T extends Record<string, import('apache-arrow').DataType>>(
          code: string,
        ) {
          const stmt = await prepare<T>(code),
            query = stmt.query.bind(stmt);
          if (code.startsWith('CREATE TEMP TABLE'))
            stmt.query = async (...values: unknown[]) => {
              const result = await query(...values);
              controller.abort();
              return result;
            };
          return stmt;
        };
      });
      let rejected = false;
      try {
        await sql.execute({
          runId: checkedId<'run'>(crypto.randomUUID()),
          signal: controller.signal,
          budget: {
            maxExecutionMs: 30000,
            maxResultRows: 100000,
            maxResultBytes: 67108864,
            maxTransferBytes: 67108864,
          },
          snapshot: {
            language: 'sql',
            code: 'SELECT * FROM range(350)',
            parameters: {},
            resolvedInputs: [],
            inputScope: 'workspace-snapshot',
            runtime: fingerprint,
            provenance: 'declared-inputs',
            notes: [],
          },
        });
      } catch {
        rejected = true;
      }
      const remaining = await runtime.operation(signal, async (_room, c) =>
        String(
          (
            await c.query(
              "SELECT count(*)::VARCHAR FROM duckdb_tables() WHERE starts_with(table_name,'__dw_')",
            )
          )
            .getChildAt(0)
            ?.get(0),
        ),
      );
      return {rejected, remaining};
    } finally {
      await sql.dispose();
    }
  });
  expect(proof).toEqual({rejected: true, remaining: '0'});
});
