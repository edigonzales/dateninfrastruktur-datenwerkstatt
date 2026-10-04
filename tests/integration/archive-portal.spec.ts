import {test, expect} from '../persistentBrowser';
import {setupPortal, portalConfig} from '../portal/setup';
test('P6 AT-051: external inclusion is opt-in, immutable public origin and IDs survive offline archive import', async ({
  page,
  request,
}) => {
  await setupPortal(page, request);
  const result = await page.evaluate(async (raw) => {
    const pp = '/src/infrastructure/catalog/portal.ts',
      hp = '/tests/spike/sqlHarness.ts';
    const {PortalAccess} = (await import(
      pp
    )) as typeof import('../../src/infrastructure/catalog/portal');
    const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
    const access = new PortalAccess(
        raw as unknown as import('../../contracts/runtime-config').RuntimeConfig,
        true,
      ),
      signal = new AbortController().signal;
    const tables = await access.resolve(
        {providerId: 'fixture', target: {kind: 'current-issue', seriesId: 'serie'}},
        signal,
      ),
      {service, session} = await sqlHarness(30000, access);
    try {
      const preview = await session.getDatasets().previewPortal(tables[0]!, signal);
      const id = await session
        .getDatasets()
        .confirm(preview.key, {name: 'Portal', sqlName: 'portal', keepOriginal: false}, signal);
      const original =
        session.document.datasetVersions[session.document.datasets[id]!.currentVersionId]!;
      const reference = await session.exportArchive(
        'with-data',
        {keepTemporary: false, includeExternal: false},
        signal,
      );
      const included = await session.exportArchive(
        'with-data',
        {keepTemporary: false, includeExternal: true},
        signal,
      );
      const before = JSON.stringify(session.document.datasetVersions);
      const candidate = await service.getArchive().inspect(included.blob, signal),
        created = await service.importArchive(candidate.id, signal);
      const fresh = await service.open(created.workspace.id);
      // No request may reach the source after this explicit inclusion.
      access.fetch = async () => {
        throw Error('network disabled');
      };
      const a = fresh.createAnalysis('sql');
      fresh.updateAnalysis(a, {code: 'SELECT sum(wert) AS total FROM portal'});
      const run = await fresh.getAnalyses().run(a),
        rid = fresh.document.runs[run]!.resultIds[0]!;
      if (!rid) throw Error(JSON.stringify(fresh.document.runs[run]));
      const rows = await fresh.getAnalyses().page(rid, {offset: 0, size: 100, sort: []}, signal);
      return {
        reference: reference.manifest,
        original,
        version: Object.values(created.datasetVersions)[0],
        rows,
        unchanged: before === JSON.stringify(session.document.datasetVersions),
        offline: candidate.inspection.missingSources,
      };
    } finally {
      await service.close();
    }
  }, portalConfig);
  expect(result.reference.files).toHaveLength(0);
  expect(result.reference.omissions.some((o) => o.reason.includes('externe Referenz'))).toBe(true);
  expect(result.version?.origin).toEqual(result.original.origin);
  expect(result.version?.id).not.toBe(result.original.id);
  expect(result.version?.backing.kind).toBe('artifact');
  expect(result.rows.rows).toEqual([['30']]);
  expect(result.unchanged).toBe(true);
  expect(result.offline).toBe(0);
});
