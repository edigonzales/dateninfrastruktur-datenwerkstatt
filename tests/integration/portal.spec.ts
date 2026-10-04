import {expect, test} from '../persistentBrowser';
import {portalConfig, setupPortal} from '../portal/setup';
test.beforeEach(async ({page, request}) => setupPortal(page, request));
test('P4 AT-033–037: real v4, concrete issue, public/local join, changed ETag, kept snapshot', async ({
  page,
  request,
}) => {
  const result = await page.evaluate(async (raw) => {
    const path = '/src/infrastructure/catalog/portal.ts';
    const harness = '/tests/spike/sqlHarness.ts';
    const {PortalAccess} = (await import(
      path
    )) as typeof import('../../src/infrastructure/catalog/portal');
    const {sqlHarness} = (await import(harness)) as typeof import('../spike/sqlHarness');
    const access = new PortalAccess(
      raw as unknown as import('../../contracts/runtime-config').RuntimeConfig,
      true,
    );
    const signal = new AbortController().signal;
    const tables = await access.resolve(
      {providerId: 'fixture', target: {kind: 'current-issue', seriesId: 'serie'}},
      signal,
    );
    const {service, session} = await sqlHarness(30000, access);
    try {
      const datasets = session.getDatasets();
      const preview = await datasets.previewPortal(tables[0]!, signal);
      const id = await datasets.confirm(
        preview.key,
        {name: 'Portal', sqlName: 'portal_daten', keepOriginal: false},
        signal,
      );
      const old =
        session.document.datasetVersions[session.document.datasets[id]!.currentVersionId]!;
      const local = await datasets.preview(
        new File(['gemeinde_id;faktor\n001;2\n002;3\n'], 'faktor.csv'),
        'csv',
        undefined,
        signal,
      );
      await datasets.confirm(
        local.key,
        {name: 'Faktor', sqlName: 'faktor', keepOriginal: false},
        signal,
      );
      const analysis = session.createAnalysis('sql');
      session.updateAnalysis(analysis, {
        code: 'SELECT p.gemeinde_id, p.wert*f.faktor AS produkt FROM portal_daten p JOIN faktor f USING(gemeinde_id) ORDER BY gemeinde_id',
      });
      const run = await session.getAnalyses().run(analysis);
      const table = Object.values(session.document.results).find(
        (r) => r.runId === run && r.kind === 'table',
      )!;
      const rows = await session
        .getAnalyses()
        .page(table.id, {offset: 0, size: 100, sort: []}, signal);
      const referencePreview = await datasets.previewPortal(tables[0]!, signal);
      await datasets.confirm(
        referencePreview.key,
        {name: 'Referenz', sqlName: 'referenz', keepOriginal: false},
        signal,
      );
      const warmRun = await session.getAnalyses().run(analysis);
      if (session.document.runs[warmRun]!.status !== 'succeeded')
        throw Error('Referenz konnte nicht vorgeladen werden.');
      await datasets.keepLocal(id, signal);
      await fetch('http://127.0.0.1:4174/__change', {method: 'POST'});
      let change = '';
      try {
        await access.fetch(tables[0]!.publicParquetUrl, signal, old);
      } catch (e) {
        change = String(e);
      }
      const failedId = await session.getAnalyses().run(analysis);
      const failed = session.document.runs[failedId]!;
      const saved = await datasets.inspect(id, signal);
      const concrete = await access.resolve(
        {providerId: 'fixture', target: tables[0]!.target},
        signal,
      );
      return {tables, old, rows, saved, change, concrete, failed};
    } finally {
      await service.close();
    }
  }, portalConfig);
  expect(result.tables).toHaveLength(2);
  expect(result.tables[0]?.target).toEqual({
    kind: 'issue',
    seriesId: 'serie',
    issueId: 'issue-2024',
  });
  expect(result.tables[0]?.publicParquetUrl).toBe('http://127.0.0.1:4174/portal/data.parquet');
  expect(JSON.stringify(result.tables)).not.toContain('evil.invalid');
  expect(result.change).toContain('SOURCE_CHANGED');
  expect(result.failed.status).toBe('failed');
  expect(result.failed.error?.code).toBe('SOURCE_CHANGED');
  expect(result.failed.resultIds).toEqual([]);
  expect(result.concrete[0]?.target).toEqual(result.tables[0]?.target);
  expect(result.saved.rows).toHaveLength(2);
  expect(result.rows.rows).toEqual([
    ['001', '20'],
    ['002', '60'],
  ]);
  const requests = (await (await request.get('http://127.0.0.1:4174/__requests')).json()) as {
    cookie: string | null;
    path: string;
  }[];
  expect(requests.every((r) => r.cookie === null && !r.path.includes('catalog.duckdb'))).toBe(true);
  const range = await request.get('http://127.0.0.1:4174/portal/data.parquet', {
    headers: {Range: 'bytes=0-3'},
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).toString()).toBe('PAR1');
});
test('P4 AT-035–036 AT-039 AT-056: errors, URL security, optional index and no foreign configuration', async ({
  page,
}) => {
  const result = await page.evaluate(async (raw) => {
    const path = '/src/infrastructure/catalog/portal.ts';
    const {PortalAccess} = (await import(
      path
    )) as typeof import('../../src/infrastructure/catalog/portal');
    const access = new PortalAccess(
        raw as unknown as import('../../contracts/runtime-config').RuntimeConfig,
        true,
      ),
      signal = new AbortController().signal;
    const errors: string[] = [];
    for (const id of ['404', 'mime', 'empty', 'nocors'])
      try {
        await access.resolve(
          {providerId: 'fixture', target: {kind: 'dataset', entryId: id}},
          signal,
        );
      } catch (e) {
        errors.push(String(e));
      }
    for (const url of [
      'https://evil.invalid/a',
      'javascript:alert(1)',
      'file:///tmp/a',
      'http://user@127.0.0.1:4174/portal/a',
      'http://127.0.0.1:4174/portal/a?token=secret',
    ])
      try {
        access.url(url);
      } catch (e) {
        errors.push(String(e));
      }
    try {
      access.deepLink('?provider=fixture&dataset=x&sql=SELECT+1');
    } catch (e) {
      errors.push(String(e));
    }
    try {
      await access.fetch('http://127.0.0.1:4174/redirect', signal);
    } catch (e) {
      errors.push(String(e));
    }
    const hits = await access.search('fixture', 'Bevölkerung', signal),
      none = await access.search('direct', 'x', signal);
    const direct = await access.resolve(
      access.selection('direct', 'http://127.0.0.1:4174/portal/datasets/bevoelkerung'),
      signal,
    );
    return {errors, hits, none, direct};
  }, portalConfig);
  expect(result.errors).toHaveLength(11);
  expect(result.errors.join(' ')).toContain('CORS');
  expect(result.errors.join(' ')).toContain('404');
  expect(result.errors.join(' ')).toContain('MIME');
  expect(result.hits).toHaveLength(1);
  expect(result.none).toEqual([]);
  expect(result.direct).toHaveLength(2);
});
