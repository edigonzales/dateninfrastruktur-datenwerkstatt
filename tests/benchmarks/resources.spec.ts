import {test, expect} from '../persistentBrowser';
import {writeFile} from 'node:fs/promises';

test('AT-071 P7 prerequisite: 20 workspace/SQL/R-reset cycles and measured 10k/100k transfers', async ({
  page,
}, info) => {
  test.setTimeout(900000);
  const workers: {closed: boolean; url: string}[] = [];
  page.on('worker', (w) => {
    const record = {closed: false, url: w.url()};
    workers.push(record);
    w.on('close', () => {
      record.closed = true;
    });
  });
  await page.goto('/tests/spike/index.html');
  await page.evaluate(async () => {
    const path = '/src/app/services.ts';
    const module = (await import(path)) as typeof import('../../src/app/services');
    const boot = await module.initializeServices();
    if (!boot.ready) throw Error(JSON.stringify(boot));
    Reflect.set(globalThis, 'benchmarkServices', module.services);
  });
  const measurements = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const result = await page.evaluate(async (cycle) => {
      const services = Reflect.get(
        globalThis,
        'benchmarkServices',
      ) as typeof import('../../src/app/services').services;
      const start = performance.now();
      const document = await services.workspaces.create(`Ressourcenzyklus ${cycle}`);
      const session = await services.workspaces.open(document.workspace.id);
      const sql = session.createAnalysis('sql');
      const r = session.createAnalysis('r');
      const rows = cycle === 0 ? 10000 : cycle === 1 ? 100000 : 4;
      session.updateAnalysis(sql, {code: `SELECT i::INTEGER AS n FROM range(${rows}) t(i)`});
      const t0 = performance.now();
      const run = await session.getAnalyses().run(sql);
      const sqlMs = performance.now() - t0;
      if (session.document.runs[run]!.status !== 'succeeded')
        throw Error(JSON.stringify(session.document.runs[run]));
      const result = session.document.runs[run]!.resultIds[0]!;
      const rService = session.getR();
      const signal = new AbortController().signal;
      const t1 = performance.now();
      const plan = await rService.planToR(result, r, 'daten', signal);
      await rService.commitToR(plan.id, rows > 10000 ? ['row-warning'] : [], signal);
      const transferMs = performance.now() - t1;
      session.updateAnalysis(r, {
        code: `stopifnot(nrow(daten)==${rows}L); check <- data.frame(rows=nrow(daten), total=sum(as.double(daten$n)))`,
      });
      const rr = await rService.run(r);
      if (session.document.runs[rr]!.status !== 'succeeded')
        throw Error(JSON.stringify(session.document.runs[rr]));
      const object = rService.objectList.find((o) => o.ref.name === 'check');
      if (!object) throw Error('R result object missing');
      const back = await rService.planFromR(object.ref, signal);
      await rService.commitFromR(back.id, 'Messung', [], signal, {sqlName: 'messung'});
      session.updateAnalysis(sql, {code: 'SELECT rows, total FROM messung'});
      const backRun = await session.getAnalyses().run(sql);
      const backId = session.document.runs[backRun]!.resultIds[0]!;
      const page = await session
        .getAnalyses()
        .page(backId, {offset: 0, size: 10, sort: []}, signal);
      await rService.reset();
      const objectsAfterReset = rService.objectList.length;
      const engine = session.getAnalyses().sql;
      await session.flush();
      const revision = session.document.revision;
      await services.workspaces.close();
      const handles: unknown = Reflect.get(engine, 'handles');
      if (!(handles instanceof Map))
        throw Error('Handle instrumentation does not match implementation');
      await services.workspaces.deleteWorkspace(document.workspace.id, revision);
      return {
        cycle,
        rows,
        sqlMs,
        transferMs,
        totalMs: performance.now() - start,
        returned: page.rows,
        objectsAfterReset,
        handlesAfterClose: handles.size,
      };
    }, cycle);
    await expect.poll(() => workers.filter((w) => !w.closed).length).toBe(0);
    expect(result.objectsAfterReset).toBe(0);
    expect(result.handlesAfterClose).toBe(0);
    expect(result.returned.map((row) => row.map(Number))).toEqual([
      [result.rows, (result.rows * (result.rows - 1)) / 2],
    ]);
    measurements.push({
      ...result,
      workersCreated: workers.length,
      workersAlive: workers.filter((w) => !w.closed).length,
    });
  }
  await writeFile(
    `docs/verification/p7-resources-${info.project.name}.json`,
    JSON.stringify(
      {
        browser: info.project.name,
        measurements,
        note: 'Wall-clock timings and real worker/handle counts; no peak-RAM claim.',
      },
      null,
      2,
    ),
  );
});
