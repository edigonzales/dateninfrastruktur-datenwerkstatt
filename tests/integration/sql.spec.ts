import {test, expect} from '../persistentBrowser';

test('P3 installed prepared CTAS and AST parameter mapping', async ({page}) => {
  await page.goto('/tests/spike/index.html');
  const proof = await page.evaluate(async () => {
    const path = '/src/infrastructure/sqlrooms/runtime.ts';
    const {DuckDbRuntime} = (await import(
      path
    )) as typeof import('../../src/infrastructure/sqlrooms/runtime');
    const runtime = new DuckDbRuntime();
    try {
      return await runtime.operation(new AbortController().signal, async (_room, c) => {
        const ast = String(
          (
            await c.query(
              `SELECT json_serialize_sql('SELECT $text AS a, CAST($exact AS BIGINT) AS b, $text AS c')`,
            )
          )
            .getChildAt(0)
            ?.get(0),
        );
        const path = '/src/infrastructure/sqlrooms/queryGuard.ts';
        const {prepareSelect} = (await import(
          path
        )) as typeof import('../../src/infrastructure/sqlrooms/queryGuard');
        const bound = await prepareSelect(
          c,
          'SELECT $text AS a, CAST($exact AS BIGINT) AS b, $text AS c;',
          new Set(),
          {text: "x'; SELECT 9; --", exact: {type: 'int64', value: '9007199254740993'}},
        );
        const statement = await c.prepare(
          `CREATE TEMP TABLE __dw_probe AS SELECT row_number() OVER () AS __dw_ordinal, * FROM (${bound.code}) LIMIT 101`,
        );
        try {
          await statement.query(...bound.values);
        } finally {
          await statement.close();
        }
        return {
          ast: JSON.parse(ast),
          bound,
          rows: (await c.query('SELECT a, b::VARCHAR AS b, c FROM __dw_probe'))
            .toArray()
            .map((r) => r.toJSON()),
        };
      });
    } finally {
      await runtime.dispose();
    }
  });
  console.log(JSON.stringify(proof));
  expect(proof.rows).toEqual([
    {a: "x'; SELECT 9; --", b: '9007199254740993', c: "x'; SELECT 9; --"},
  ]);
});

test('P3 / AT-022 AT-025 AT-027 AT-028 AT-029: real SQL result limits, bindings, stability and exact display', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async () => {
    const runtimePath = '/src/infrastructure/sqlrooms/runtime.ts';
    const enginePath = '/src/infrastructure/sqlrooms/sqlEngine.ts';
    const domainPath = '/src/domain/workspace.ts';
    const {DuckDbRuntime} = (await import(
      runtimePath
    )) as typeof import('../../src/infrastructure/sqlrooms/runtime');
    const {SqlRoomsSqlEngine} = (await import(
      enginePath
    )) as typeof import('../../src/infrastructure/sqlrooms/sqlEngine');
    const {checkedId} = (await import(domainPath)) as typeof import('../../src/domain/workspace');
    const runtime = new DuckDbRuntime();
    const engine = new SqlRoomsSqlEngine(
      runtime,
      async () => {
        throw Error('No dataset expected');
      },
      'test',
    );
    const signal = new AbortController().signal;
    const fingerprint = await engine.fingerprint();
    const execute = async (
      code: string,
      maxResultRows = 1000,
      maxResultBytes = 67108864,
      parameters: import('../../src/domain/model').Analysis['parameters'] = {},
    ) =>
      engine.execute({
        runId: checkedId<'run'>(crypto.randomUUID()),
        signal,
        budget: {maxExecutionMs: 30000, maxResultRows, maxResultBytes, maxTransferBytes: 67108864},
        snapshot: {
          language: 'sql',
          code,
          parameters,
          resolvedInputs: [],
          inputScope: 'workspace-snapshot',
          runtime: fingerprint,
          provenance: 'declared-inputs',
          notes: [],
        },
      });
    try {
      const one = await execute('SELECT 1 AS wert;');
      const exact = await execute(
        "SELECT $text AS t, CAST($exact AS BIGINT) AS n, 9007199254740993 AS constant, 123456789012345678.1234::DECIMAL(22,4) AS decimal, '$text; $exact' AS literal, 3 AS n",
        1000,
        67108864,
        {text: "'; ATTACH 'evil'; --", exact: {type: 'int64', value: '9007199254740993'}},
      );
      const random = await execute('SELECT i, random() AS r FROM range(350) AS t(i)');
      const first = await engine.readPage(random.table, {offset: 0, size: 100, sort: []}, signal);
      await engine.readPage(
        random.table,
        {offset: 100, size: 100, sort: [{column: 'i', direction: 'desc'}]},
        signal,
      );
      const again = await engine.readPage(random.table, {offset: 0, size: 100, sort: []}, signal);
      const descending = await engine.readPage(
        random.table,
        {offset: 0, size: 100, sort: [{column: 'i', direction: 'desc'}]},
        signal,
      );
      const limited = await execute('SELECT * FROM range(1500)');
      const complete = await execute('SELECT * FROM range(1500) LIMIT 10');
      let overflow = '';
      try {
        await execute("SELECT repeat('x',10000) AS text FROM range(10)", 1000, 1000);
      } catch (e) {
        overflow = String(e);
      }
      const kept = await engine.snapshotParquet(random.table, signal);
      const restored = await engine.restore(
        kept,
        random.table.schema,
        random.table.rowCount,
        signal,
      );
      const restoredPage = await engine.readPage(
        restored,
        {offset: 0, size: 100, sort: []},
        signal,
      );
      return {
        one: await engine.readPage(one.table, {offset: 0, size: 100, sort: []}, signal),
        exact: await engine.readPage(exact.table, {offset: 0, size: 100, sort: []}, signal),
        warnings: exact.warnings,
        first,
        again,
        descending,
        restoredPage,
        limited: {rows: limited.table.rowCount, limited: limited.limited},
        complete: {rows: complete.table.rowCount, limited: complete.limited},
        overflow,
      };
    } finally {
      await engine.dispose();
    }
  });
  expect(result.one.rows).toEqual([['1']]);
  expect(result.exact.rows).toEqual([
    [
      "'; ATTACH 'evil'; --",
      '9007199254740993',
      '9007199254740993',
      '123456789012345678.1234',
      '$text; $exact',
      '3',
    ],
  ]);
  expect(result.warnings).toHaveLength(1);
  expect(result.first).toEqual(result.again);
  expect(result.first).toEqual(result.restoredPage);
  expect(result.descending.rows[0]?.[0]).toBe('349');
  expect(result.limited).toEqual({rows: '1000', limited: true});
  expect(result.complete).toEqual({rows: '10', limited: false});
  expect(result.overflow).toContain('Budget');
});

test('P3 / AT-021 AT-026 AT-032: CSV datasets → frozen Golden SQL → kept result → reopen/export', async ({
  page,
}) => {
  const {readFile} = await import('node:fs/promises');
  const [code, gemeinden, bevoelkerung, fahrzeuge, goldenText] = await Promise.all(
    [
      '01-fahrzeuge-pro-1000.sql',
      'gemeinden.csv',
      'bevoelkerung.csv',
      'fahrzeuge.csv',
      'golden/sql-2024.json',
    ].map((file) => readFile(`fixtures/${file}`, 'utf8')),
  );
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(
    async ({code, csvs}) => {
      const path = '/tests/spike/sqlHarness.ts';
      const {sqlHarness} = (await import(path)) as typeof import('../spike/sqlHarness');
      const {service, session} = await sqlHarness();
      const signal = new AbortController().signal;
      try {
        for (const [name, text] of Object.entries(csvs)) {
          const file = new File([text], `${name}.csv`);
          const preview = await session.getDatasets().preview(file, 'csv', undefined, signal);
          await session
            .getDatasets()
            .confirm(preview.key, {name, sqlName: name, keepOriginal: false}, signal);
        }
        const id = session.createAnalysis('sql');
        session.updateAnalysis(id, {code, parameters: {jahr: 2024}});
        const pending = session.getAnalyses().run(id);
        session.updateAnalysis(id, {code: 'SELECT 999 AS newer_code', parameters: {jahr: 2023}});
        const runId = await pending;
        const run = session.document.runs[runId]!;
        if (run.status !== 'succeeded') throw Error(JSON.stringify(run));
        const resultId = run.resultIds[0]!;
        const first = await session
          .getAnalyses()
          .page(resultId, {offset: 0, size: 100, sort: []}, signal);
        const result = session.document.results[resultId]!;
        await session.getAnalyses().keep(resultId);
        const temporaryId = await session.getAnalyses().run(id);
        const temporaryResult = session.document.runs[temporaryId]!.resultIds[0]!;
        const workspaceId = session.document.workspace.id;
        await service.close();
        const reopened = await service.open(workspaceId);
        const again = await reopened
          .getAnalyses()
          .page(resultId, {offset: 0, size: 100, sort: []}, signal);
        const csv = await new Response(
          await reopened.getAnalyses().export(resultId, 'csv', signal),
        ).text();
        const external = await new Response(
          await reopened.getAnalyses().export(resultId, 'parquet', signal),
        ).blob();
        const preview = await reopened
          .getDatasets()
          .preview(new File([external], 'result.parquet'), 'parquet', undefined, signal);
        return {
          run,
          first,
          again,
          result,
          code: reopened.document.analyses[id]!.code,
          temporary: reopened.document.results[temporaryResult]!.materialization,
          csv,
          exportColumns: preview.schema.columns.map((c) => c.name),
        };
      } finally {
        await service.close();
      }
    },
    {
      code: code!,
      csvs: {gemeinden: gemeinden!, bevoelkerung: bevoelkerung!, fahrzeuge: fahrzeuge!},
    },
  );
  const golden = JSON.parse(goldenText!) as {rows: Record<string, string | number | null>[]};
  expect(result.run.snapshot.code).toBe(code);
  expect(result.run.snapshot.parameters).toEqual({jahr: 2024});
  expect(result.run.snapshot.resolvedInputs).toHaveLength(3);
  expect(result.code).toBe('SELECT 999 AS newer_code');
  expect(result.result.kind).toBe('table');
  const expected = golden.rows.map((row) =>
    Object.values(row).map((value) => (value === null ? null : String(value))),
  );
  // DuckDB DOUBLE display may include .0; compare numbers only in declared numeric columns.
  const rows = result.first.rows.map((row) =>
    row.map((v, i) => (i >= 2 && v !== null ? Number(v) : v)),
  );
  expect(rows).toEqual(
    expected.map((row) => row.map((v, i) => (i >= 2 && v !== null ? Number(v) : v))),
  );
  expect(result.first).toEqual(result.again);
  expect(result.temporary).toEqual({kind: 'unavailable', reason: 'session-ended'});
  expect(result.exportColumns).toHaveLength(6);
  expect(result.csv).not.toContain('__dw_ordinal');
});

test('P3 / AT-030 AT-031: actual worker termination, epoch invalidation, no late success and fresh small query', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async () => {
    const path = '/tests/spike/sqlHarness.ts';
    const {sqlHarness} = (await import(path)) as typeof import('../spike/sqlHarness');
    const {service, session} = await sqlHarness(1000);
    const original = Worker.prototype.terminate;
    let terminated = 0;
    Worker.prototype.terminate = function () {
      terminated++;
      return original.call(this);
    };
    try {
      const id = session.createAnalysis('sql');
      const app = session.getAnalyses();
      await app.sql.initialize(new AbortController().signal);
      const smallId = await app.run(id);
      const resultId = session.document.runs[smallId]!.resultIds[0]!;
      session.updateAnalysis(id, {
        code: 'SELECT sum(a.i * b.i) FROM range(100000000) a(i), range(100000000) b(i)',
      });
      const epoch = app.sql.epoch;
      const pending = app.run(id);
      let duplicate = '';
      try {
        await app.run(id);
      } catch (e) {
        duplicate = String(e);
      }
      const timed = await pending;
      const epochAfter = app.sql.epoch;
      const run = session.document.runs[timed]!;
      const old = session.document.results[resultId]!.materialization;
      session.updateAnalysis(id, {code: 'SELECT 7 AS answer'});
      const next = await app.run(id);
      const page = await app.page(
        session.document.runs[next]!.resultIds[0]!,
        {offset: 0, size: 100, sort: []},
        new AbortController().signal,
      );
      return {epoch, epochAfter, run, old, page, terminated, duplicate};
    } finally {
      await service.close();
      Worker.prototype.terminate = original;
    }
  });
  expect(result.epochAfter).toBeGreaterThan(result.epoch);
  expect(result.terminated).toBeGreaterThan(0);
  expect(result.run.status).toBe('cancelled');
  expect(result.run.stopReason).toBe('timeout');
  expect(result.run.resultIds).toEqual([]);
  expect(result.old).toEqual({kind: 'unavailable', reason: 'runtime-reset'});
  expect(result.page.rows).toEqual([['7']]);
  expect(result.duplicate).toContain('Operation läuft');
});

test('P3 / AT-023: analytic syntax allowed, indirect external/internal sources rejected before execution', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async () => {
    const runtimePath = '/src/infrastructure/sqlrooms/runtime.ts';
    const guardPath = '/src/infrastructure/sqlrooms/queryGuard.ts';
    const {DuckDbRuntime} = (await import(
      runtimePath
    )) as typeof import('../../src/infrastructure/sqlrooms/runtime');
    const {prepareSelect} = (await import(
      guardPath
    )) as typeof import('../../src/infrastructure/sqlrooms/queryGuard');
    const runtime = new DuckDbRuntime();
    try {
      return await runtime.operation(new AbortController().signal, async (_room, c) => {
        const allowed = [
          '-- comment\n SELECT \'; $x\' AS "a;b"',
          'WITH t AS (SELECT 1 AS a) SELECT a FROM t UNION ALL SELECT 2',
          'SELECT i, sum(i) OVER (ORDER BY i) AS total FROM range(5) t(i)',
          'SELECT * FROM (SELECT 1 AS a) t WHERE a IN (SELECT 1)',
          'SELECT * FROM unnest([1,2,3])',
          'WITH t AS (SELECT 1 AS a), u AS (SELECT * FROM t) SELECT * FROM u',
        ];
        const blocked = [
          'SELECT 1; SELECT 2',
          "COPY (SELECT 1) TO 'x.csv'",
          "ATTACH 'x.db'",
          'INSTALL httpfs',
          'LOAD httpfs',
          'SET TimeZone=UTC',
          "SELECT * FROM read_parquet('https://evil.invalid/x.parquet')",
          "SELECT * FROM query('SELECT 1')",
          'SELECT * FROM __dw_ordinal',
          "SELECT * FROM 'https://evil.invalid/x.parquet'",
          'SELECT * FROM (WITH stolen AS (SELECT 1) SELECT * FROM stolen) a, stolen',
          'WITH "https://evil.invalid/x.parquet" AS (SELECT * FROM "https://evil.invalid/x.parquet") SELECT 1',
          "SELECT nextval('x')",
          'SELECT * FROM duckdb_tables()',
        ];
        const good: string[] = [],
          bad: string[] = [];
        for (const code of allowed) {
          const q = await prepareSelect(c, code, new Set(), {});
          await c.query(q.code);
          good.push(code);
        }
        for (const code of blocked) {
          try {
            await prepareSelect(c, code, new Set(), {});
            bad.push(code);
          } catch {
            /* Required guard rejection. */
          }
        }
        return {good, bad};
      });
    } finally {
      await runtime.dispose();
    }
  });
  expect(result.good).toHaveLength(6);
  expect(result.bad).toEqual([]);
});

test('P3 / AT-049 AT-050: chart boundaries and atomic keep failure with real result', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async () => {
    const path = '/tests/spike/sqlHarness.ts';
    const {sqlHarness} = (await import(path)) as typeof import('../spike/sqlHarness');
    const {service, session, repository, artifacts} = await sqlHarness();
    const signal = new AbortController().signal;
    try {
      const app = session.getAnalyses();
      const id = session.createAnalysis('sql');
      session.updateAnalysis(id, {
        code: 'SELECT i AS x, CASE WHEN i = 2 THEN NULL ELSE i*2 END AS y FROM range(5) t(i) ORDER BY i DESC',
      });
      const run = await app.run(id);
      const resultId = session.document.runs[run]!.resultIds[0]!;
      const chart = await app.chartData(resultId, {type: 'line', x: 'x', y: 'y'}, signal);
      const commit = repository.commit.bind(repository);
      repository.commit = async (d, revision) => {
        if (d.results[resultId]?.retention === 'kept')
          throw Error('Injected metadata commit failure');
        return commit(d, revision);
      };
      let failure = '';
      try {
        await app.saveVisualization(resultId, 'Test', {type: 'bar', x: 'x', y: 'y'});
      } catch (e) {
        failure = String(e);
      }
      const after = {
        result: session.document.results[resultId]!,
        charts: Object.keys(session.document.visualizations),
        artifacts: Object.keys(session.document.artifacts),
      };
      let files = 0;
      for await (const _file of artifacts.list(session.document.workspace.id)) files++;
      repository.commit = commit;
      session.persistence.acknowledgeUnpublishedFailure();
      await app.saveVisualization(resultId, 'Test', {type: 'bar', x: 'x', y: 'y'});
      session.updateAnalysis(id, {code: 'SELECT i AS x, i AS y FROM range(5001) t(i)'});
      const longRun = await app.run(id);
      let limit = '';
      try {
        await app.chartData(
          session.document.runs[longRun]!.resultIds[0]!,
          {type: 'bar', x: 'x', y: 'y'},
          signal,
        );
      } catch (e) {
        limit = String(e);
      }
      session.updateAnalysis(id, {code: 'SELECT i AS x, i AS y FROM range(101) t(i)'});
      const categoriesRun = await app.run(id);
      let categoryLimit = '';
      try {
        await app.chartData(
          session.document.runs[categoriesRun]!.resultIds[0]!,
          {type: 'bar', x: 'x', y: 'y'},
          signal,
        );
      } catch (e) {
        categoryLimit = String(e);
      }
      return {
        chart,
        failure,
        after,
        files,
        kept: session.document.results[resultId]!,
        charts: Object.keys(session.document.visualizations),
        limit,
        categoryLimit,
      };
    } finally {
      await service.close();
    }
  });
  expect(result.chart.rows).toEqual([
    ['0', '0'],
    ['1', '2'],
    ['2', null],
    ['3', '6'],
    ['4', '8'],
  ]);
  expect(result.failure).toContain('Injected');
  expect(result.after.result.retention).toBe('temporary');
  expect(result.after.charts).toEqual([]);
  expect(result.after.artifacts).toEqual([]);
  expect(result.files).toBe(1);
  expect(result.kept.retention).toBe('kept');
  expect(result.charts).toHaveLength(1);
  expect(result.limit).toContain('5000');
  expect(result.categoryLimit).toContain('100 Kategorien');
});
