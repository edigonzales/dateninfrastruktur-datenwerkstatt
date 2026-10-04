import {test, expect} from '../persistentBrowser';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolateOpfs} from '../isolateOpfs';
test('P6 AT-051 AT-053 AT-063: Golden archive in fresh profile, graph remap, real SQL/PNG, duplicate and independent deletion', async ({
  page,
  playwright,
  browserName,
}) => {
  await page.goto('/workspaces');
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Archiv Golden');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  const names = [
    'gemeinden.csv',
    'bevoelkerung.csv',
    'fahrzeuge.csv',
    '01-fahrzeuge-pro-1000.sql',
    '02-vergleich.R',
    '02b-plot.R',
    '03-klassifikation.sql',
  ];
  const files = Object.fromEntries(
    await Promise.all(names.map(async (n) => [n, await readFile(`fixtures/${n}`, 'utf8')])),
  );
  const original = await page.evaluate(async (files) => {
    const sp = '/src/app/services.ts',
      seed = '/tests/spike/seedGolden.ts';
    const {services} = (await import(sp)) as typeof import('../../src/app/services');
    const {seedGolden} = (await import(seed)) as typeof import('../spike/seedGolden');
    return seedGolden(await services.workspaces.open(location.pathname.split('/')[2]!), files);
  }, files);
  await page.getByRole('button', {name: 'Projekt exportieren', exact: true}).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Archiv herunterladen'}).click();
  const archive = await download;
  const bytes = await readFile((await archive.path())!);
  const folder = await mkdtemp(join(tmpdir(), 'dw-fresh-archive-'));
  const fresh = await playwright[browserName].launchPersistentContext(folder, {
    headless: true,
    baseURL: 'http://127.0.0.1:4173',
  });
  const cleanup = await isolateOpfs(fresh);
  try {
    const imported = fresh.pages()[0] ?? (await fresh.newPage());
    const workers: string[] = [];
    imported.on('worker', (w) => workers.push(w.url()));
    await imported.goto('/workspaces');
    await imported
      .getByLabel('Projektdatei importieren')
      .setInputFiles({name: 'rundlauf.dwproj', mimeType: 'application/zip', buffer: bytes});
    await expect(imported.getByRole('dialog')).toContainText('Enthält SQL-/R-Code');
    await imported.getByRole('button', {name: 'Als neuen Arbeitsbereich importieren'}).click();
    await expect(imported.getByRole('heading', {name: 'Archiv Golden', exact: true})).toBeVisible();
    expect(workers).toEqual([]);
    const proof = await imported.evaluate(async () => {
      const path = '/src/app/services.ts';
      const {services} = (await import(path)) as typeof import('../../src/app/services');
      const session = await services.workspaces.open(location.pathname.split('/')[2]!),
        d = session.document,
        signal = new AbortController().signal;
      const result = Object.values(d.visualizations)[0]!.tableResultId;
      const rows = await session
        .getAnalyses()
        .page(result, {offset: 0, size: 100, sort: []}, signal);
      const plot = Object.values(d.results).find((r) => r.kind === 'plot')!;
      const png = new Uint8Array(await (await session.getR().plot(plot.id, signal)).arrayBuffer());
      const a = session.createAnalysis('sql');
      session.updateAnalysis(a, {code: 'SELECT COUNT(*) AS n FROM vergleich'});
      const run = await session.getAnalyses().run(a);
      const query = await session
        .getAnalyses()
        .page(session.document.runs[run]!.resultIds[0]!, {offset: 0, size: 100, sort: []}, signal);
      // Tombstones preserve all historical versions/kept inputs and artifacts during cleanup.
      const dataset = Object.values(d.datasets).find((ds) => ds.sqlName === 'gemeinden')!;
      session.removeDataset(dataset.id);
      session.archiveAnalysis(Object.values(d.analyses).find((a) => a.name === 'Golden SQL')!.id);
      await session.getDatasets().cleanOrphans(signal);
      await session.flush();
      return {document: d, rows, query, png: [...png.slice(0, 8)], after: session.document};
    });
    const old = original.document,
      next = proof.document;
    expect(next.workspace.id).not.toBe(old.workspace.id);
    for (const key of [
      'datasets',
      'datasetVersions',
      'analyses',
      'runs',
      'results',
      'visualizations',
      'artifacts',
    ] as const) {
      expect(Object.keys(next[key])).toHaveLength(Object.keys(old[key]).length);
      expect(Object.keys(next[key]).some((id) => id in old[key])).toBe(false);
    }
    expect(Object.values(next.analyses).map((a) => a.code)).toEqual(
      Object.values(old.analyses).map((a) => a.code),
    );
    expect(Object.values(next.datasets).map((a) => a.sqlName)).toEqual(
      Object.values(old.datasets).map((a) => a.sqlName),
    );
    expect(proof.rows.rows).toEqual([
      ['hoch', '2'],
      ['nicht berechenbar', '1'],
      ['niedrig', '1'],
    ]);
    expect(proof.query.rows).toEqual([['4']]);
    expect(proof.png).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(Object.keys(proof.after.artifacts)).toHaveLength(Object.keys(next.artifacts).length);
    expect(workers.filter((w) => w.includes('webr'))).toHaveLength(0);
    await imported.reload();
    await imported.getByRole('button', {name: 'Arbeitsbereich duplizieren', exact: true}).click();
    await expect(
      imported.getByRole('heading', {name: 'Archiv Golden (Kopie)', exact: true}),
    ).toBeVisible();
    const copyUrl = imported.url();
    await imported.getByRole('link', {name: 'Arbeitsbereiche', exact: true}).click();
    await imported.getByRole('link', {name: 'Archiv Golden', exact: true}).click();
    await imported.getByRole('button', {name: 'Arbeitsbereich löschen', exact: true}).click();
    await expect(imported.getByRole('dialog')).toContainText('gesicherte Resultate');
    await imported.getByRole('button', {name: 'Endgültig löschen'}).click();
    await expect(
      imported.getByRole('heading', {name: 'Arbeitsbereiche', exact: true}),
    ).toBeVisible();
    await expect(imported.getByRole('link', {name: 'Archiv Golden', exact: true})).toHaveCount(0);
    await imported.goto(copyUrl);
    await imported.getByRole('link', {name: 'Rück-SQL', exact: true}).click();
    await expect(imported.locator('.result-grid tbody tr')).toHaveCount(3);
  } finally {
    try {
      await cleanup();
    } finally {
      await fresh.close();
      await rm(folder, {recursive: true, force: true});
    }
  }
  await page.reload();
  await expect(page.getByRole('heading', {name: 'Archiv Golden', exact: true})).toBeVisible();
});
test('P6 AT-059: recipe inspection/confirmation without engine or empty fake tables', async ({
  page,
}) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await page.goto('/workspaces');
  await page.getByLabel('Projektdatei importieren').setInputFiles('fixtures/sample.dwproj');
  await expect(page.getByRole('dialog')).toContainText('3 Datenstände fehlen');
  await page.getByRole('button', {name: 'Als neuen Arbeitsbereich importieren'}).click();
  await expect(page.locator('.dataset-list').getByText(/Zeilen · Nicht verfügbar/)).toHaveCount(3);
  expect(workers).toEqual([]);
  await page.getByRole('button', {name: 'Projekt exportieren', exact: true}).click();
  await page.getByLabel('Archivmodus').selectOption('recipe');
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Archiv herunterladen'}).click();
  expect((await download).suggestedFilename()).toBe('datenwerkstatt.dwproj');
});
