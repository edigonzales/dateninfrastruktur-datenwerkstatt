import {test, expect} from '../persistentBrowser';
import config from '../../public/runtime-config.json' with {type: 'json'};

test('P8 AT-007: separate predecessor upgrade rolls back schema and data, then migrates atomically', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const proof = await page.evaluate(async () => {
    const path = '/tests/spike/migration.ts';
    return ((await import(path)) as typeof import('../spike/migration')).migrationProof();
  });
  expect(proof.error).toContain('Injected test migration failure');
  expect(proof.afterFailure).toEqual(proof.predecessor);
  expect(proof.versionAfterFailure).toBe(1);
  expect(proof.tablesAfterFailure).toEqual(['projects']);
  expect(proof.migrated.formatVersion).toBe(1);
  expect(proof.migrated.workspace.name).toBe(proof.predecessor.oldName);
  expect(proof.legacyCount).toBe(0);
});

test('P8 AT-019: replacement is rejected during real SQL; old snapshot stays v1, next run reads v2', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const proof = await page.evaluate(async () => {
    const path = '/tests/spike/sqlHarness.ts';
    const {sqlHarness} = (await import(path)) as typeof import('../spike/sqlHarness');
    const {service, session} = await sqlHarness();
    const signal = new AbortController().signal;
    let release!: () => void;
    try {
      const datasets = session.getDatasets();
      const first = await datasets.preview(
        new File(['wert\n1\n'], 'v1.csv'),
        'csv',
        undefined,
        signal,
      );
      const dataset = await datasets.confirm(
        first.key,
        {name: 'Daten', sqlName: 'daten', keepOriginal: false},
        signal,
      );
      const v1 = structuredClone(
        session.document.datasetVersions[session.document.datasets[dataset]!.currentVersionId]!,
      );
      const second = await datasets.preview(
        new File(['wert;neu\n2;zusatz\n'], 'v2.csv'),
        'csv',
        undefined,
        signal,
      );
      const analyses = session.getAnalyses();
      const id = session.createAnalysis('sql');
      session.updateAnalysis(id, {code: 'SELECT wert FROM daten'});
      const execute = analyses.sql.execute.bind(analyses.sql);
      let ready!: () => void;
      const started = new Promise<void>((r) => {
        ready = r;
      });
      const held = new Promise<void>((r) => {
        release = r;
      });
      analyses.sql.execute = async (request) => {
        const response = await execute(request);
        ready();
        await held;
        return response;
      };
      const pending = analyses.run(id);
      await started;
      let blocked = '';
      try {
        await datasets.confirm(
          second.key,
          {name: 'Daten', sqlName: 'daten', keepOriginal: false, replace: dataset},
          signal,
        );
      } catch (e) {
        blocked = String(e);
      }
      const during = session.document.datasets[dataset]!.currentVersionId;
      release();
      const firstRun = await pending;
      analyses.sql.execute = execute;
      await datasets.confirm(
        second.key,
        {name: 'Daten', sqlName: 'daten', keepOriginal: false, replace: dataset},
        signal,
      );
      const nextRun = await analyses.run(id);
      const rows = async (run: typeof firstRun) =>
        analyses.page(
          session.document.runs[run]!.resultIds[0]!,
          {offset: 0, size: 100, sort: []},
          signal,
        );
      return {
        blocked,
        during,
        v1,
        v1After: session.document.datasetVersions[v1.id],
        versions: Object.values(session.document.datasetVersions),
        current: session.document.datasets[dataset]!.currentVersionId,
        oldRun: session.document.runs[firstRun],
        newRun: session.document.runs[nextRun],
        oldRows: await rows(firstRun),
        newRows: await rows(nextRun),
      };
    } finally {
      release?.();
      await service.close();
    }
  });
  expect(proof.blocked).toContain('Operation läuft');
  expect(proof.during).toBe(proof.v1.id);
  expect(proof.v1After).toEqual(proof.v1);
  expect(proof.versions).toHaveLength(2);
  expect(proof.current).not.toBe(proof.v1.id);
  expect(proof.oldRun?.snapshot.resolvedInputs[0]).toMatchObject({versionId: proof.v1.id});
  expect(proof.newRun?.snapshot.resolvedInputs[0]).toMatchObject({versionId: proof.current});
  expect(proof.oldRows.rows).toEqual([['1']]);
  expect(proof.newRows.rows).toEqual([['2']]);
  expect(proof.versions[1]!.schema.columns.map((c) => c.name)).toEqual(['wert', 'neu']);
});

for (const language of ['sql', 'r'] as const) {
  test(`P8 AT-024: delayed real ${language} response is discarded on workspace switch and resources close`, async ({
    page,
  }) => {
    await page.goto('/tests/spike/index.html');
    const workers: {closed: boolean}[] = [];
    page.on('worker', (worker) => {
      const w = {closed: false};
      workers.push(w);
      worker.on('close', () => {
        w.closed = true;
      });
    });
    const proof = await page.evaluate(
      async ({language, config}) => {
        const path = '/tests/spike/sqlHarness.ts';
        const {sqlHarness} = (await import(path)) as typeof import('../spike/sqlHarness');
        const {service, session, rEngines} = await sqlHarness(
          30000,
          undefined,
          config as unknown as import('../../contracts/runtime-config').RuntimeConfig,
        );
        const signal = new AbortController().signal;
        const p = await session
          .getDatasets()
          .preview(new File(['wert\n17\n'], 'a.csv'), 'csv', undefined, signal);
        await session
          .getDatasets()
          .confirm(p.key, {name: 'Geheim', sqlName: 'geheim_in_a', keepOriginal: false}, signal);
        const target = await service.create('Leeres B');
        const sql = session.getAnalyses().sql;
        const id = session.createAnalysis(language);
        session.updateAnalysis(id, {
          code:
            language === 'sql'
              ? 'SELECT * FROM geheim_in_a'
              : 'secret <- data.frame(wert=17L); plot(1:3); cat("late output")',
        });
        let ready!: () => void;
        const started = new Promise<void>((r) => {
          ready = r;
        });
        let release!: () => void;
        const held = new Promise<void>((r) => {
          release = r;
        });
        let aborted = false;
        const pictures: ImageBitmap[] = [];
        const delay = async (signal: AbortSignal) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              release();
            },
            {once: true},
          );
          ready();
          await held;
        };
        try {
          if (language === 'sql') {
            const execute = sql.execute.bind(sql);
            sql.execute = async (request) => {
              const result = await execute(request);
              await delay(request.signal);
              return result;
            };
          } else {
            const rs = session.getR();
            await rs.activate(id);
            const engine = rEngines[0]!;
            const evaluate = engine.evaluate.bind(engine);
            engine.evaluate = async (scope, run, snapshot, onEvent, signal) => {
              await evaluate(
                scope,
                run,
                snapshot,
                (e) => {
                  if (e.kind === 'plot') pictures.push(e.image);
                  onEvent(e);
                },
                signal,
              );
              await delay(signal);
            };
          }
          const pending =
            language === 'sql' ? session.getAnalyses().run(id) : session.getR().run(id);
          await started;
          const b = await service.open(target.workspace.id);
          const oldRun = await pending;
          const beforeB = structuredClone(b.document);
          const query = b.createAnalysis('sql');
          b.updateAnalysis(query, {code: 'SELECT * FROM geheim_in_a'});
          const rejected = await b.getAnalyses().run(query);
          const handles: unknown = Reflect.get(sql, 'handles');
          if (!(handles instanceof Map)) throw Error('Unknown handle registry');
          return {
            aborted,
            oldRun: session.document.runs[oldRun],
            oldResults: Object.keys(session.document.results),
            beforeB,
            rejected: b.document.runs[rejected],
            handles: handles.size,
            closedPictures: pictures.map((p) => [p.width, p.height]),
            rObjects: language === 'r' ? session.getR().objectList.length : 0,
          };
        } finally {
          release();
          await service.close();
        }
      },
      {language, config},
    );
    expect(proof.aborted).toBe(true);
    expect(proof.oldRun).toMatchObject({
      status: 'cancelled',
      stopReason: 'workspace-close',
      resultIds: [],
    });
    expect(proof.oldResults).toEqual([]);
    expect(Object.keys(proof.beforeB.datasets)).toEqual([]);
    expect(Object.keys(proof.beforeB.results)).toEqual([]);
    expect(Object.keys(proof.beforeB.runs)).toEqual([]);
    expect(proof.rejected).toMatchObject({status: 'failed', resultIds: []});
    expect(proof.handles).toBe(0);
    expect(proof.rObjects).toBe(0);
    if (language === 'r') expect(proof.closedPictures).toEqual([[0, 0]]);
    await expect.poll(() => workers.filter((w) => !w.closed).length).toBe(0);
  });
}
