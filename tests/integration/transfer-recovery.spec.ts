import {test, expect} from '../persistentBrowser';
import config from '../../public/runtime-config.json' with {type: 'json'};
test('P6 AT-013 AT-050 AT-052: quota blocks persistent R input; workspace change aborts real capture after OPFS write without late publication', async ({
  page,
}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async (raw) => {
    const hp = '/tests/spike/sqlHarness.ts',
      ap = '/src/infrastructure/storage/artifactStore.ts';
    const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
    const {OpfsArtifactStore} = (await import(
      ap
    )) as typeof import('../../src/infrastructure/storage/artifactStore');
    const {service, session, repository, artifacts} = await sqlHarness(
      30000,
      undefined,
      raw as unknown as import('../../contracts/runtime-config').RuntimeConfig,
      new OpfsArtifactStore(134217728),
    );
    const signal = new AbortController().signal,
      write = artifacts.write.bind(artifacts);
    try {
      const a = session.createAnalysis('sql'),
        r = session.createAnalysis('r');
      session.updateAnalysis(a, {code: 'SELECT 73::INTEGER AS n'});
      const run = await session.getAnalyses().run(a),
        resultId = session.document.runs[run]!.resultIds[0]!,
        rs = session.getR();
      const plan = await rs.planToR(resultId, r, 'daten', signal);
      artifacts.write = async () => {
        throw new DOMException('injected quota', 'QuotaExceededError');
      };
      let quota = '';
      try {
        await rs.commitToR(plan.id, [], signal);
      } catch (e) {
        quota = String(e);
      }
      const failedInputs = session.document.analyses[r]!.inputs.length,
        failedMaterialization = session.document.results[resultId]!.materialization.kind;
      const exportedOnFailure = await session.exportArchive(
        'recipe',
        {keepTemporary: false, includeExternal: false},
        signal,
      );
      artifacts.write = write;
      await rs.commitToR(plan.id, [], signal);
      session.updateAnalysis(r, {code: 'captured <- data.frame(n=daten$n + 1L)'});
      const rr = await rs.run(r);
      if (session.document.runs[rr]!.status !== 'succeeded') throw Error('R execution failed');
      const capture = await rs.planFromR(
        rs.objectList.find((o) => o.ref.name === 'captured')!.ref,
        signal,
      );
      await session.flush();
      const before = structuredClone(session.document),
        other = await service.create('Independent');
      let written: (() => void) | undefined;
      const reached = new Promise<void>((resolve) => {
        written = resolve;
      });
      artifacts.write = async (id, data, media, joined) => {
        const artifact = await write(id, data, media, joined);
        written!();
        await new Promise<void>((resolve, reject) => {
          void resolve;
          joined.addEventListener('abort', () => reject(joined.reason), {once: true});
          if (joined.aborted) reject(joined.reason);
        });
        return artifact;
      };
      const pending = rs.commitFromR(capture.id, 'capture', [], signal).then(
        () => 'UNEXPECTED_SUCCESS',
        (e: unknown) => String(e),
      );
      await reached;
      const next = await service.open(other.workspace.id),
        aborted = await pending;
      artifacts.write = write;
      const after = await repository.load(before.workspace.id),
        otherAfter = next.document;
      const reopened = await service.open(before.workspace.id);
      const orphans = await reopened.getDatasets().inventory(signal);
      await reopened.getDatasets().cleanOrphans(signal);
      const cleaned = await reopened.getDatasets().inventory(signal);
      return {
        quota,
        failedInputs,
        failedMaterialization,
        exportBytes: exportedOnFailure.blob.size,
        aborted,
        stable: JSON.stringify(after) === JSON.stringify(before),
        independent: JSON.stringify(otherAfter) === JSON.stringify(other),
        orphans: orphans.orphans.length,
        cleaned: cleaned.orphans.length,
        kept: await reopened.getAnalyses().page(resultId, {offset: 0, size: 100, sort: []}, signal),
      };
    } finally {
      artifacts.write = write;
      await service.close();
    }
  }, config);
  expect(result.quota).toContain('QuotaExceededError');
  expect(result.failedInputs).toBe(0);
  expect(result.failedMaterialization).toBe('session');
  expect(result.exportBytes).toBeGreaterThan(0);
  expect(result.aborted).toContain('AbortError');
  expect(result.stable).toBe(true);
  expect(result.independent).toBe(true);
  expect(result.orphans).toBe(1);
  expect(result.cleaned).toBe(0);
  expect(result.kept.rows).toEqual([['73']]);
});
