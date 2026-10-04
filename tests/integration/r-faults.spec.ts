import {test, expect} from '../persistentBrowser';
import config from '../../public/runtime-config.json' with {type: 'json'};
test('P5 AT-045 AT-052 AT-062: approvals, unsupported columns, stale edits, write/commit failure, console and plot limits', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async (raw) => {
    const hp = '/tests/spike/sqlHarness.ts';
    const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
    const {service, session, artifacts, repository} = await sqlHarness(
      30000,
      undefined,
      raw as unknown as import('../../contracts/runtime-config').RuntimeConfig,
    );
    const signal = new AbortController().signal;
    const caught = async (work: () => Promise<unknown>) => {
      try {
        await work();
        return '';
      } catch (e) {
        return String(e);
      }
    };
    try {
      const a = session.createAnalysis('sql'),
        r = session.createAnalysis('r'),
        rs = session.getR();
      const sql = async (code: string) => {
        session.updateAnalysis(a, {code});
        const run = await session.getAnalyses().run(a);
        return session.document.runs[run]!.resultIds[0]!;
      };
      const rid = await sql('SELECT i::INTEGER AS n FROM range(10001) t(i)');
      const warning = await rs.planToR(rid, r, 'daten', signal);
      const approval = await caught(() => rs.commitToR(warning.id, [], signal));
      const write = artifacts.write.bind(artifacts);
      artifacts.write = async () => {
        throw Error('injected write');
      };
      const writeFailure = await caught(() => rs.commitToR(warning.id, ['row-warning'], signal));
      const inputsAfterFailure = session.document.analyses[r]!.inputs.length;
      artifacts.write = write;
      await rs.commitToR(warning.id, ['row-warning'], signal);
      const collision = await rs.planToR(rid, r, 'daten', signal);
      session.updateAnalysis(r, {
        code: 'stopifnot(nrow(daten)==10001L); vergleich <- data.frame(n=integer(0)); z <- data.frame(blob=I(list(1:3)))',
      });
      const stale = await caught(() =>
        rs.commitToR(collision.id, ['row-warning', 'replace-variable'], signal),
      );
      const run = await rs.run(r);
      if (session.document.runs[run]!.status !== 'succeeded')
        throw Error(JSON.stringify(session.document.runs[run]));
      const unsupportedR = await caught(() =>
        rs.planFromR(rs.objectList.find((o) => o.ref.name === 'z')!.ref, signal),
      );
      const plan = await rs.planFromR(
        rs.objectList.find((o) => o.ref.name === 'vergleich')!.ref,
        signal,
      );
      const before = JSON.stringify(session.document);
      const commit = repository.commit.bind(repository);
      repository.commit = async () => {
        throw Error('injected commit');
      };
      const commitFailure = await caught(() => rs.commitFromR(plan.id, 'leer', [], signal));
      const atomic = before === JSON.stringify(session.document);
      repository.commit = commit;
      await rs.commitFromR(plan.id, 'leer', [], signal, {sqlName: 'leer'});
      const empty = Object.values(session.document.datasetVersions).find(
        (v) => v.origin.kind === 'result',
      )!.rowCount;
      const blob = await sql("SELECT 'abc'::BLOB AS blob, {'a':1} AS struct");
      const unsupportedSQL = await caught(() => rs.planToR(blob, r, 'blob', signal));
      session.updateAnalysis(r, {
        code: 'zu_gross <- data.frame(x=seq_len(100001)); cat(paste(rep("zeile",2100),collapse="\\n")); for(i in 1:11) plot(1:2)',
      });
      const limited = await rs.run(r);
      if (session.document.runs[limited]!.status !== 'succeeded')
        throw Error(JSON.stringify(session.document.runs[limited]));
      const hard = await caught(() =>
        rs.planFromR(rs.objectList.find((o) => o.ref.name === 'zu_gross')!.ref, signal),
      );
      session.updateAnalysis(r, {code: 'plot(1:2); stop("bewusster Fehler")'});
      const failed = await rs.run(r);
      return {
        approval,
        writeFailure,
        inputsAfterFailure,
        stale,
        unsupportedR,
        commitFailure,
        atomic,
        empty,
        unsupportedSQL,
        hard,
        limited: session.document.runs[limited],
        lines: rs.console(limited).length,
        failed: session.document.runs[failed],
      };
    } finally {
      await service.close();
    }
  }, config);
  expect(result.approval).toContain('bestätigen');
  expect(result.writeFailure).toContain('injected write');
  expect(result.inputsAfterFailure).toBe(0);
  expect(result.stale).toMatch(/veraltet|geändert/);
  expect(result.unsupportedR).toContain('blob');
  expect(result.commitFailure).toContain('injected commit');
  expect(result.atomic).toBe(true);
  expect(result.empty).toBe('0');
  expect(result.unsupportedSQL).toMatch(/blob.*struct/);
  expect(result.hard).toContain('Transferbudget');
  expect(result.limited?.resultIds).toHaveLength(10);
  expect(result.limited?.warnings).toHaveLength(2);
  expect(result.lines).toBe(2000);
  expect(result.failed?.status).toBe('failed');
  expect(result.failed?.resultIds).toHaveLength(0);
});
