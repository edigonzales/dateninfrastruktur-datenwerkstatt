import {test, expect} from '../persistentBrowser';
import {readFile} from 'node:fs/promises';
import config from '../../public/runtime-config.json' with {type: 'json'};
test('P5 AT-042–045: full typed SQL → R → SQL including NA/NaN, exact decimals, dates, factor and rejected casts', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const sql = await readFile('fixtures/04-typgrenzen.sql', 'utf8');
  const proof = await page.evaluate(
    async ({config, sql}) => {
      const hp = '/tests/spike/sqlHarness.ts';
      const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
      const {service, session} = await sqlHarness(
        30000,
        undefined,
        config as unknown as import('../../contracts/runtime-config').RuntimeConfig,
      );
      const signal = new AbortController().signal;
      try {
        const a = session.createAnalysis('sql');
        session.updateAnalysis(a, {code: sql});
        const run = await session.getAnalyses().run(a);
        const rid = session.document.runs[run]!.resultIds[0]!;
        const original = await session
          .getAnalyses()
          .page(rid, {offset: 0, size: 100, sort: []}, signal);
        const r = session.createAnalysis('r'),
          rs = session.getR();
        const plan = await rs.planToR(rid, r, 'daten', signal);
        await rs.commitToR(
          plan.id,
          plan.issues.map((i) => i.id),
          signal,
        );
        const noAutorun = Object.values(session.document.runs).filter(
          (r) => r.snapshot.language === 'r',
        ).length;
        session.updateAnalysis(r, {
          code: 'stopifnot(is.nan(daten$nan_wert), is.na(daten$fehlend), daten$int32_min == -2147483648, daten$wide_int64 == "9007199254740993", inherits(daten$datum,"Date"), inherits(daten$zeit_utc,"POSIXct")); vergleich <- daten; vergleich$faktor <- factor("b",levels=c("a","b","unused")); vergleich',
        });
        const rr = await rs.run(r);
        if (session.document.runs[rr]!.status !== 'succeeded')
          throw Error(JSON.stringify(session.document.runs[rr]!.error));
        const ref = rs.objectList.find((o) => o.ref.name === 'vergleich')!.ref;
        const back = await rs.planFromR(ref, signal);
        await rs.commitFromR(
          back.id,
          'r_vergleich',
          back.issues.map((i) => i.id),
          signal,
          {sqlName: 'r_vergleich'},
        );
        session.updateAnalysis(a, {code: 'SELECT * EXCLUDE(faktor) FROM r_vergleich'});
        const returnedRun = await session.getAnalyses().run(a);
        const returnedId = session.document.runs[returnedRun]!.resultIds[0]!;
        const returned = await session
          .getAnalyses()
          .page(returnedId, {offset: 0, size: 100, sort: []}, signal);
        const factor = Object.values(session.document.datasetVersions)
          .find((v) => v.origin.kind === 'result')!
          .schema.columns.find((c) => c.name === 'faktor');
        session.updateAnalysis(r, {code: 'vergleich$exakter_betrag[1] <- "kaputt"'});
        await rs.run(r);
        let rejected = '';
        try {
          await rs.planFromR(ref, signal);
        } catch (e) {
          rejected = String(e);
        }
        return {
          original,
          returned,
          noAutorun,
          plan,
          factor,
          rejected,
          kept: session.document.results[rid]!.retention,
        };
      } finally {
        await service.close();
      }
    },
    {config, sql},
  );
  expect(proof.noAutorun).toBe(0);
  expect(proof.kept).toBe('kept');
  expect(proof.returned.rows).toEqual(proof.original.rows);
  expect(proof.factor?.metadata.factorLevels).toBe('["a","b","unused"]');
  expect(proof.rejected).toContain('DECIMAL');
});
test('P5 AT-040 AT-042 AT-047 AT-052: 350 rows, stale plans, five inactive fresh scopes and genuine R worker stop', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async (raw) => {
    const hp = '/tests/spike/sqlHarness.ts';
    const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
    const config = raw as unknown as import('../../contracts/runtime-config').RuntimeConfig;
    // Keep the real initialization budget; only the execution under test times out at 1s.
    const {service, session} = await sqlHarness(30000, undefined, config, undefined, 1000),
      signal = new AbortController().signal;
    try {
      const a = session.createAnalysis('sql');
      session.updateAnalysis(a, {code: 'SELECT i::INTEGER AS id FROM range(350) t(i)'});
      const sr = await session.getAnalyses().run(a),
        rid = session.document.runs[sr]!.resultIds[0]!;
      const r = session.createAnalysis('r'),
        rs = session.getR();
      const plan = await rs.planToR(rid, r, 'daten', signal);
      await rs.commitToR(plan.id, [], signal);
      session.updateAnalysis(r, {
        code: 'stopifnot(nrow(daten)==350L,all(daten$id==0:349), is.integer(daten$id)); x <- 7; vergleich <- daten',
      });
      const ok = await rs.run(r);
      if (session.document.runs[ok]!.status !== 'succeeded')
        throw Error(JSON.stringify(session.document.runs[ok]!.error));
      const old = rs.objectList.find((o) => o.ref.name === 'vergleich')!.ref;
      const stale = await rs.planFromR(old, signal);
      await rs.reset();
      let rejected = '';
      try {
        await rs.commitFromR(stale.id, 'stale', [], signal);
      } catch (e) {
        rejected = String(e);
      }
      session.updateAnalysis(r, {code: 'repeat { x <- 1 + 1 }'});
      const timed = await rs.run(r);
      session.updateAnalysis(r, {code: 'stopifnot(nrow(daten)==350); vergleich <- daten'});
      const after = await rs.run(r);
      session.updateAnalysis(r, {
        environmentMode: 'fresh-environment',
        code: 'stopifnot(!exists("x",inherits=FALSE)); x <- 10; vergleich <- daten',
      });
      const fresh = await rs.run(r);
      for (let i = 0; i < 7; i++) {
        const next = await rs.run(r);
        if (session.document.runs[next]!.status !== 'succeeded') throw Error('Fresh scope failed');
      }
      await rs.selectRun(fresh);
      const pruned = rs.objectList.length;
      return {
        pruned,
        ok: session.document.runs[ok],
        timed: session.document.runs[timed],
        after: session.document.runs[after],
        fresh: session.document.runs[fresh],
        rejected,
        objects: rs.objectList,
        epoch: rs.epoch,
      };
    } finally {
      await service.close();
    }
  }, config);
  expect(result.pruned).toBe(0);
  expect(result.ok?.status).toBe('succeeded');
  expect(result.timed?.status).toBe('cancelled');
  expect(result.timed?.stopReason).toBe('timeout');
  expect(result.after?.status).toBe('succeeded');
  expect(result.fresh?.status).toBe('succeeded');
  expect(result.rejected).toContain('veraltet');
  expect(result.epoch).toBeGreaterThanOrEqual(2);
});
