import {test, expect} from '../persistentBrowser';
import config from '../../public/runtime-config.json' with {type: 'json'};
test('P5/P6 AT-025 AT-048: native R parameters, selection snapshot, seed and capture of a later object mutation', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const proof = await page.evaluate(async (raw) => {
    const hp = '/tests/spike/sqlHarness.ts';
    const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
    const {service, session} = await sqlHarness(
      30000,
      undefined,
      raw as unknown as import('../../contracts/runtime-config').RuntimeConfig,
    );
    const signal = new AbortController().signal;
    try {
      const a = session.createAnalysis('r'),
        rs = session.getR();
      const parameters: import('../../src/domain/model').Analysis['parameters'] = {
        text: "'); stop('parameter must stay data')",
        flag: true,
        missing: null,
        n: 4,
        wide: {type: 'int64', value: '9007199254740993'},
        decimal: {type: 'decimal', value: '1.2300'},
      };
      const selected = `stopifnot(is.list(params), is.character(params$text), params$flag, is.null(params$missing), identical(params$wide,"9007199254740993"), identical(params$decimal,"1.2300"), params$n==4); out <- data.frame(n=params$n, x=runif(1)); out`;
      session.updateAnalysis(a, {
        code: 'stop("full script must not run")',
        parameters,
        randomSeed: 73,
      });
      const pending = rs.run(a, selected);
      session.updateAnalysis(a, {
        code: 'stop("changed editor must not run")',
        parameters: {n: 99},
        randomSeed: 99,
      });
      const first = await pending;
      if (session.document.runs[first]!.status !== 'succeeded')
        throw Error(JSON.stringify(session.document.runs[first]!.error));
      const before = await rs.previewObject(
        rs.objectList.find((o) => o.ref.name === 'out')!.ref,
        signal,
      );
      session.updateAnalysis(a, {parameters, randomSeed: 73});
      const second = await rs.run(a, selected);
      if (session.document.runs[second]!.status !== 'succeeded') throw Error('Second run failed');
      const repeat = await rs.previewObject(
        rs.objectList.find((o) => o.ref.name === 'out')!.ref,
        signal,
      );
      const mutate = await rs.run(a, 'out$n[1] <- 9');
      if (session.document.runs[mutate]!.status !== 'succeeded') throw Error('Mutation failed');
      const plan = await rs.planFromR(rs.objectList.find((o) => o.ref.name === 'out')!.ref, signal);
      const runsBefore = Object.keys(session.document.runs).length;
      await rs.commitFromR(plan.id, 'out', [], signal, {sqlName: 'out'});
      const runsAfter = Object.keys(session.document.runs).length;
      const capture = Object.values(session.document.runs).find(
        (r) => r.trigger === 'r-object-capture',
      )!;
      const rows = await session
        .getAnalyses()
        .page(capture.resultIds[0]!, {offset: 0, size: 100, sort: []}, signal);
      return {
        snapshot: session.document.runs[first]!.snapshot,
        parameters,
        selected,
        before,
        repeat,
        rows,
        capture,
        runsBefore,
        runsAfter,
        editor: session.document.analyses[a]!.code,
      };
    } finally {
      await service.close();
    }
  }, config);
  expect(proof.snapshot.parameters).toEqual(proof.parameters);
  expect(proof.snapshot.code).toBe(proof.selected);
  expect(proof.snapshot.randomSeed).toBe(73);
  expect(proof.editor).toContain('changed editor must not run');
  expect(proof.repeat.rows).toEqual(proof.before.rows);
  // Ordinary R numeric scalars remain DOUBLE in SQL, including their exact display type.
  expect(proof.rows.rows[0]?.[0]).toBe('9.0');
  expect(proof.runsAfter).toBe(proof.runsBefore + 1);
  expect(proof.capture.snapshot.inputScope).toBe('session-capture');
  expect(proof.capture.snapshot.code).toBe('');
});
