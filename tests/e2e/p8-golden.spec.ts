import {test, expect, type BrowserContext, type Page} from '@playwright/test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolateOpfs} from '../isolateOpfs';
import {portalConfig} from '../portal/setup';
import type {WorkspaceDocument} from '../../src/domain/model';
import {parseWorkspace, workspaceSchema} from '../../src/domain/workspace';
import {ZipArchiveCodec} from '../../src/infrastructure/archive/zip';

async function editor(page: Page, code: string, name?: string) {
  if (name) await page.getByLabel('Analysename', {exact: true}).fill(name);
  await page.locator('.monaco-editor').click();
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+a');
  // Installed Monaco's documented trigger API routes through its real paste
  // handler (codeEditorWidget.js). Firefox ignores synthetic ClipboardEvents;
  // IME-style insertText can instead add brackets to multiline fixtures.
  await page.evaluate(async (text) => {
    const path = '/src/infrastructure/monaco/runtime.ts';
    const {monaco} = (await import(
      path
    )) as typeof import('../../src/infrastructure/monaco/runtime');
    monaco.editor.getEditors()[0]!.trigger('keyboard', 'paste', {text, pasteOnNewLine: false});
  }, code);
  expect(
    await page.evaluate(async () => {
      const path = '/src/infrastructure/monaco/runtime.ts';
      const {monaco} = (await import(
        path
      )) as typeof import('../../src/infrastructure/monaco/runtime');
      return monaco.editor.getEditors()[0]!.getModel()!.getValue();
    }),
  ).toBe(code);
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+s');
}
async function documentOf(page: Page) {
  return page.evaluate(async () => {
    const p = '/src/app/services.ts';
    const {services} = (await import(p)) as typeof import('../../src/app/services');
    const session = await services.workspaces.open(location.pathname.split('/')[2]!);
    await session.flush();
    return session.document;
  });
}
function expectedRows(text: string) {
  return (JSON.parse(text) as {rows: Record<string, string | number | null>[]}).rows.map(
    Object.values,
  );
}
async function tableRows(page: Page, selector: string, numeric: number[]) {
  return page.locator(selector).evaluateAll(
    (rows, numeric) =>
      rows.map((row) =>
        [...row.querySelectorAll('td')].map((td, i) => {
          const text = td.textContent ?? '';
          return text === 'NULL' ? null : numeric.includes(i) ? Number(text) : text;
        }),
      ),
    numeric,
  );
}

test('P8 AT-072: portal population + local CSV, unchanged Golden SQL/R, process restart and second fresh archive profile', async ({
  playwright,
  browserName,
  request,
}, info) => {
  test.setTimeout(240000);
  const folder = await mkdtemp(join(tmpdir(), 'dw-golden-pilot-'));
  const storageKey = crypto.randomUUID(),
    key = `proof-${crypto.randomUUID()}`;
  const names = [
    'bevoelkerung.csv',
    '01-fahrzeuge-pro-1000.sql',
    '02-vergleich.R',
    '02b-plot.R',
    '03-klassifikation.sql',
    'golden/sql-2024.json',
    'golden/r-vergleich.json',
    'golden/rueck-sql.json',
  ];
  const files = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(`fixtures/${name}`, 'utf8')]),
    ),
  );
  const start = Date.now();
  let context: BrowserContext | undefined, clean: (() => Promise<void>) | undefined;
  const open = async (profile: string, opfsKey: ReturnType<typeof crypto.randomUUID>) => {
    context = await playwright[browserName].launchPersistentContext(join(folder, profile), {
      headless: true,
      baseURL: 'http://127.0.0.1:4173',
      viewport: {width: 1440, height: 900},
      timezoneId: 'UTC',
    });
    clean = await isolateOpfs(context, opfsKey);
    await context.route('**/runtime-config.json', (route) => route.fulfill({json: portalConfig}));
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(20000);
    return page;
  };
  try {
    let page = await open('original', storageKey);
    // Only fixture preparation uses the engine adapter directly; the product workflow below uses UI actions.
    await page.goto('/tests/spike/index.html');
    await page.evaluate(
      async ({csv, key}) => {
        const p = '/src/infrastructure/sqlrooms/fileImportEngine.ts';
        const {DuckDbFileImportEngine} = (await import(
          p
        )) as typeof import('../../src/infrastructure/sqlrooms/fileImportEngine');
        const engine = new DuckDbFileImportEngine(134217728),
          signal = new AbortController().signal;
        try {
          const preview = await engine.preview(
            new File([csv], 'population.csv'),
            'csv',
            undefined,
            signal,
          );
          const prepared = await engine.prepare(preview.key, signal);
          const response = await fetch(`http://127.0.0.1:4174/__namedfile/${key}`, {
            method: 'POST',
            body: await new Response(prepared.data).arrayBuffer(),
          });
          if (!response.ok) throw Error('Fixture upload failed');
        } finally {
          await engine.dispose();
        }
      },
      {csv: files['bevoelkerung.csv']!, key},
    );
    const network: string[] = [];
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) network.push(r.url());
    });
    await page.goto('/workspaces');
    await page.getByLabel('Name des neuen Arbeitsbereichs').fill('P8 Golden');
    await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
    await expect(page.getByRole('heading', {name: 'P8 Golden', exact: true})).toBeVisible();
    const workspaceUrl = page.url();
    for (const name of ['gemeinden', 'fahrzeuge']) {
      await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
      await page
        .getByLabel('Datei (CSV oder Parquet, maximal 128 MiB)')
        .setInputFiles(`fixtures/${name}.csv`);
      await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
      await page.getByRole('button', {name: 'Import bestätigen', exact: true}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.getByRole('button', {name: 'Aus Portal hinzufügen', exact: true}).click();
    await page.getByLabel('Dataset-ID oder Portal-URL').fill(key);
    await page.getByRole('button', {name: 'Kontext laden', exact: true}).click();
    await page.getByRole('button', {name: 'Portalvorschau laden', exact: true}).click();
    await page.getByLabel('SQL-Name', {exact: true}).fill('bevoelkerung');
    await page.getByLabel('Anzeigename', {exact: true}).fill('Bevölkerung aus Fixture-Portal');
    await page.getByRole('button', {name: 'Portalimport bestätigen', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
    await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
    await editor(page, files['01-fahrzeuge-pro-1000.sql']!, 'Golden SQL');
    await page.getByText('Parameter (0)', {exact: true}).click();
    await page.getByRole('button', {name: 'Parameter hinzufügen', exact: true}).click();
    await page.getByLabel('Parameter 1 Name').fill('jahr');
    await page.getByLabel('Parameter 1 Typ').selectOption('number');
    await page.getByLabel('Parameter 1 Wert').fill('2024');
    await page.getByRole('button', {name: 'Parameter übernehmen', exact: true}).click();
    await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
    await expect(page.locator('.result-grid tbody tr')).toHaveCount(4);
    expect(await tableRows(page, '.result-grid tbody tr', [2, 3, 4, 5])).toEqual(
      expectedRows(files['golden/sql-2024.json']!),
    );
    await page.getByRole('button', {name: 'In R', exact: true}).click();
    await page.getByRole('button', {name: 'Transfer prüfen', exact: true}).click();
    await expect(page.getByText(/4 Zeilen .*Bytes Transferpayload/)).toBeVisible({timeout: 60000});
    for (const checkbox of await page.getByRole('dialog').getByRole('checkbox').all())
      await checkbox.check();
    await page.getByRole('button', {name: 'In R übernehmen', exact: true}).click();
    await expect(page.locator('.r-workbench')).toBeVisible();
    await editor(page, files['02-vergleich.R']!, 'Golden R');
    await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
    await page.getByRole('button', {name: /vergleich · 4 × 7/}).click();
    await expect(page.locator('.r-output tbody tr')).toHaveCount(4);
    expect(await tableRows(page, '.r-output tbody tr', [2, 3, 4, 5])).toEqual(
      expectedRows(files['golden/r-vergleich.json']!),
    );
    await page.getByRole('button', {name: 'Objekt als Datensatz', exact: true}).click();
    await page.getByRole('button', {name: 'Datensatz übernehmen', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
    await page.getByRole('button', {name: 'Neues R-Skript', exact: true}).click();
    await editor(page, files['02b-plot.R']!, 'Golden Plot');
    await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
    await expect(page.locator('.r-plot img')).toBeVisible();
    await page.getByRole('button', {name: 'Grafik aufbewahren', exact: true}).click();
    await expect(
      page.getByRole('button', {name: 'Grafik aufbewahren', exact: true}),
    ).toBeDisabled();
    const pngDownload = page.waitForEvent('download');
    await page.getByRole('button', {name: 'PNG herunterladen', exact: true}).click();
    expect((await readFile((await (await pngDownload).path())!)).subarray(1, 4).toString()).toBe(
      'PNG',
    );
    await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
    await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
    await editor(page, files['03-klassifikation.sql']!, 'Rück-SQL');
    await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
    await expect(page.locator('.result-grid tbody tr')).toHaveCount(3);
    const returned = expectedRows(files['golden/rueck-sql.json']!);
    expect(await tableRows(page, '.result-grid tbody tr', [])).toEqual(returned);
    await page.getByRole('button', {name: 'Diagramm', exact: true}).click();
    await page.getByRole('button', {name: 'Diagramm speichern', exact: true}).click();
    await expect(page.getByText('1 Diagramm(e) gespeichert', {exact: true})).toBeVisible();
    await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
    await page.getByRole('button', {name: 'Lokal sichern', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Lokal sichern', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Projekt exportieren', exact: true}).click();
    await page.getByLabel('Externe Quellen ebenfalls sichern').check();
    const archiveDownload = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Archiv herunterladen', exact: true}).click();
    const archive = await readFile((await (await archiveDownload).path())!);
    const entries = await new ZipArchiveCodec().read(
      new Blob([new Uint8Array(archive)]),
      new AbortController().signal,
    );
    const manifest: unknown = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
    if (!manifest || typeof manifest !== 'object' || !('project' in manifest))
      throw Error('Missing manifest project');
    const exported = workspaceSchema.parse(manifest.project) as WorkspaceDocument;
    // Manifest paths are portable; the domain validator expects managed paths.
    for (const a of Object.values(exported.artifacts))
      a.path = `workspaces/${exported.workspace.id}/artifacts/${a.id}`;
    parseWorkspace(exported);
    const original = await documentOf(page);
    const runIds = Object.keys(original.runs);
    expect(Object.values(original.analyses).find((a) => a.name === 'Golden SQL')!.code).toBe(
      files['01-fahrzeuge-pro-1000.sql'],
    );
    expect(Object.values(original.analyses).find((a) => a.name === 'Golden R')!.code).toBe(
      files['02-vergleich.R'],
    );
    const publicVersion = Object.values(original.datasetVersions).find(
      (v) => v.backing.kind === 'public-parquet',
    )!;
    expect(publicVersion.origin).toMatchObject({kind: 'portal', providerId: 'fixture'});
    expect(JSON.stringify(publicVersion.origin)).toContain(key);
    expect(network.some((url) => url.includes(`/datasets/${key}/data.parquet`))).toBe(true);
    expect(
      network.filter(
        (url) => !['http://127.0.0.1:4173', 'http://127.0.0.1:4174'].includes(new URL(url).origin),
      ),
    ).toEqual([]);
    // Close the native persistent browser process; retain only this test's profile/OPFS root.
    const browser = context!.browser();
    await context!.close();
    context = undefined;
    clean = undefined;
    expect(browser?.isConnected()).toBe(false);
    page = await open('original', storageKey);
    const workers: string[] = [];
    page.on('worker', (w) => workers.push(w.url()));
    await page.route('http://127.0.0.1:4174/**', (route) => route.abort());
    await page.goto(workspaceUrl);
    await expect(page.getByRole('heading', {name: 'P8 Golden', exact: true})).toBeVisible();
    expect(workers).toEqual([]);
    const reopened = await documentOf(page);
    expect(Object.keys(reopened.runs)).toEqual(runIds);
    expect(reopened.analyses).toEqual(original.analyses);
    await page.getByRole('link', {name: 'Rück-SQL', exact: true}).click();
    await expect(page.locator('.result-grid tbody tr')).toHaveCount(3);
    expect(await tableRows(page, '.result-grid tbody tr', [])).toEqual(returned);
    expect(Object.keys((await documentOf(page)).runs)).toEqual(runIds);
    await clean!();
    await context!.close();
    context = undefined;
    clean = undefined;
    page = await open('imported', crypto.randomUUID());
    const importedWorkers: string[] = [];
    page.on('worker', (w) => importedWorkers.push(w.url()));
    await page.route('http://127.0.0.1:4174/**', (route) => route.abort());
    await page.goto('/workspaces');
    await expect(page.getByRole('link', {name: 'P8 Golden', exact: true})).toHaveCount(0);
    await page
      .getByLabel('Projektdatei importieren')
      .setInputFiles({name: 'golden.dwproj', mimeType: 'application/zip', buffer: archive});
    await page
      .getByRole('button', {name: 'Als neuen Arbeitsbereich importieren', exact: true})
      .click();
    await expect(page.getByRole('heading', {name: 'P8 Golden', exact: true})).toBeVisible();
    expect(importedWorkers).toEqual([]);
    const imported = await documentOf(page);
    expect(imported.workspace.id).not.toBe(original.workspace.id);
    for (const key of [
      'datasets',
      'datasetVersions',
      'analyses',
      'runs',
      'results',
      'visualizations',
      'artifacts',
    ] as const) {
      // Explicit external inclusion adds a new archive artifact without mutating
      // the source project. Compare remapped IDs against the reviewed manifest.
      expect(Object.keys(imported[key])).toHaveLength(Object.keys(exported[key]).length);
      expect(Object.keys(imported[key]).some((id) => id in exported[key])).toBe(false);
    }
    const codes = (d: WorkspaceDocument) =>
      Object.values(d.analyses)
        .map((a) => a.code)
        .sort();
    expect(codes(imported)).toEqual(codes(original));
    expect(
      Object.values(imported.datasetVersions)
        .filter((v) => v.origin.kind === 'portal')
        .every((v) => JSON.stringify(v.origin).includes(key)),
    ).toBe(true);
    await page.getByRole('link', {name: 'Rück-SQL', exact: true}).click();
    await expect(page.locator('.result-grid tbody tr')).toHaveCount(3);
    expect(await tableRows(page, '.result-grid tbody tr', [])).toEqual(returned);
    expect(Object.keys((await documentOf(page)).runs)).toEqual(Object.keys(imported.runs));
    await page.screenshot({path: `docs/verification/p8-golden-${info.project.name}.png`});
    await writeFile(
      `docs/verification/p8-golden-${info.project.name}.json`,
      JSON.stringify(
        {
          browser: info.project.name,
          totalMs: Date.now() - start,
          originalWorkspace: original.workspace.id,
          importedWorkspace: imported.workspace.id,
          runCount: runIds.length,
          resultCount: Object.keys(original.results).length,
          publicVersion,
          returned,
          network,
          processRestart: true,
          noAutorun: true,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      if (context) await clean?.();
    } finally {
      await context?.close();
      await rm(folder, {recursive: true, force: true});
      await request.delete(`http://127.0.0.1:4174/__namedfile/${key}`);
    }
  }
});
