import {test, expect} from './fixture';
import {readFile} from 'node:fs/promises';
import type {Page} from '@playwright/test';

async function code(page: Page, value: string) {
  await page.locator('.monaco-editor').click();
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+a');
  await page.keyboard.insertText(value);
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+s');
}

test('P7 AT-056 AT-068: static public/local → SQL → R → SQL → PNG/archive with recorded network', async ({
  page,
  request,
  baseURL,
}, info) => {
  const network: string[] = [],
    errors: string[] = [];
  await page.addInitScript(() => {
    Reflect.set(globalThis, 'violations', []);
    document.addEventListener('securitypolicyviolation', (e) => {
      (Reflect.get(globalThis, 'violations') as string[]).push(
        `${e.effectiveDirective}: ${e.blockedURI}`,
      );
    });
  });
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseURL}workspaces`);
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Netzwerk Rundlauf');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
  await page.getByLabel('Datei (CSV oder Parquet, maximal 128 MiB)').setInputFiles({
    name: 'lokal.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('gemeinde_id;wert\n001;10\n002;20\n'),
  });
  await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
  await page.getByRole('button', {name: 'Import bestätigen', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  const sqlUrl = page.url();
  await code(page, 'SELECT * FROM lokal');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.result-grid tbody tr')).toHaveCount(2);
  // Prepare the HTTP fixture with real exported Parquet, independently per test.
  const parquetDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: 'PARQUET exportieren', exact: true}).click();
  const bytes = await readFile((await (await parquetDownload).path())!);
  const key = `proof-${crypto.randomUUID()}`;
  expect((await request.post(`http://127.0.0.1:4174/__namedfile/${key}`, {data: bytes})).ok()).toBe(
    true,
  );
  try {
    await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
    await page.getByRole('button', {name: 'Aus Portal hinzufügen', exact: true}).click();
    await page.getByLabel('Dataset-ID oder Portal-URL').fill(key);
    await page.getByRole('button', {name: 'Kontext laden', exact: true}).click();
    await page.getByRole('button', {name: 'Portalvorschau laden', exact: true}).click();
    await expect(page.getByRole('cell', {name: '001', exact: true})).toBeVisible();
    await page.getByRole('button', {name: 'Portalimport bestätigen', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(globalThis, 'marker'))).toBeUndefined();
    await page.getByRole('button', {name: 'SQL', exact: true}).click();
    expect(page.url()).toBe(sqlUrl);
    await code(
      page,
      'SELECT l.gemeinde_id, l.wert+p.wert AS total FROM lokal l JOIN portal_daten p ON l.gemeinde_id=p.gemeinde_id ORDER BY l.gemeinde_id',
    );
    await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
    await expect(page.locator('.result-grid tbody td')).toHaveText(['001', '20', '002', '40']);
    await page.getByRole('button', {name: 'In R', exact: true}).click();
    await page.getByRole('button', {name: 'Transfer prüfen', exact: true}).click();
    await page.getByRole('button', {name: 'In R übernehmen', exact: true}).click();
    await expect(page.locator('.r-workbench')).toBeVisible();
    await code(
      page,
      'vergleich <- data.frame(n=nrow(daten), total=sum(as.double(daten$total))); plot(as.double(daten$total)); cat("Netzwerk geprüft")',
    );
    await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
    await expect(page.getByRole('log')).toContainText('Netzwerk geprüft');
    await page.getByRole('button', {name: 'Grafik aufbewahren', exact: true}).click();
    await expect(
      page.getByRole('button', {name: 'Grafik aufbewahren', exact: true}),
    ).toBeDisabled();
    const pngDownload = page.waitForEvent('download');
    await page.getByRole('button', {name: 'PNG herunterladen', exact: true}).click();
    expect((await readFile((await (await pngDownload).path())!)).subarray(1, 4).toString()).toBe(
      'PNG',
    );
    await page.getByRole('button', {name: /vergleich · 1 × 2/}).click();
    await page.getByRole('button', {name: 'Objekt als Datensatz', exact: true}).click();
    await page.getByRole('button', {name: 'Datensatz übernehmen', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', {name: 'SQL', exact: true}).click();
    await code(page, 'SELECT n, total FROM vergleich');
    await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
    await expect(page.locator('.result-grid tbody td')).toHaveText(['2', '60.0']);
    await page.getByRole('button', {name: 'Diagramm', exact: true}).click();
    await page.getByRole('button', {name: 'Diagramm speichern', exact: true}).click();
    await expect(page.getByText('1 Diagramm(e) gespeichert', {exact: true})).toBeVisible();
    await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
    await page.getByRole('button', {name: 'Projekt exportieren', exact: true}).click();
    await page.getByLabel('Externe Quellen ebenfalls sichern').check();
    const archiveDownload = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Archiv herunterladen', exact: true}).click();
    const archive = await readFile((await (await archiveDownload).path())!);
    await page.getByRole('link', {name: 'Arbeitsbereiche', exact: true}).click();
    await page
      .getByLabel('Projektdatei importieren')
      .setInputFiles({name: 'netzwerk.dwproj', mimeType: 'application/zip', buffer: archive});
    await page
      .getByRole('button', {name: 'Als neuen Arbeitsbereich importieren', exact: true})
      .click();
    await expect(page.getByRole('heading', {name: 'Netzwerk Rundlauf', exact: true})).toBeVisible();
    await page.getByRole('link', {name: 'Neue SQL-Abfrage', exact: true}).click();
    await expect(page.locator('.result-grid tbody td')).toHaveText(['2', '60.0']);
    expect(await page.evaluate(() => Reflect.get(globalThis, 'violations'))).toEqual([]);
    expect(errors).toEqual([]);
    const allowed = [new URL(baseURL!).origin, 'http://127.0.0.1:4174'];
    expect(network.filter((url) => !allowed.includes(new URL(url).origin))).toEqual([]);
    expect(network.some((url) => url.includes(`/datasets/${key}/`))).toBe(true);
    expect(
      await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)),
    ).toBe(0);
    await info.attach('complete-core-network', {
      body: JSON.stringify(network, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await request.delete(`http://127.0.0.1:4174/__namedfile/${key}`);
  }
});
