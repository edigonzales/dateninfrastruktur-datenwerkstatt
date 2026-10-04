import {test, expect} from './fixture';
import type {Page} from '@playwright/test';
async function start(page: Page, baseURL: string) {
  await page.goto(`${baseURL}workspaces`);
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Fehler und Retry');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
}
async function code(page: Page, text: string) {
  await page.locator('.monaco-editor').click();
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}
test('P7 AT-069: missing/wrong MIME runtime assets fail explicitly; retry owns one valid worker', async ({
  page,
  baseURL,
}) => {
  const workers: {url: string; closed: boolean}[] = [];
  page.on('worker', (w) => {
    const rec = {url: w.url(), closed: false};
    workers.push(rec);
    w.on('close', () => {
      rec.closed = true;
    });
  });
  let blockSql = true,
    blockR = true;
  await page.route('**/vendor/duckdb/**/*.wasm', async (route) => {
    if (blockSql)
      await route.fulfill({status: 404, contentType: 'text/html', body: 'Missing runtime asset'});
    else await route.continue();
  });
  await page.route('**/vendor/webr/0.6.0/R.wasm', async (route) => {
    if (blockR)
      await route.fulfill({status: 200, contentType: 'text/html', body: 'Not a WASM module'});
    else await route.continue();
  });
  await start(page, baseURL!);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.getByRole('alert').filter({hasText: 'SOURCE_UNAVAILABLE'})).toContainText(
    'HTTP 404',
  );
  expect(workers.filter((w) => !w.url.includes('editor.worker'))).toHaveLength(0);
  blockSql = false;
  await page.getByRole('button', {name: 'Hinweis schliessen'}).click();
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.result-grid tbody td')).toHaveText(['1']);
  expect(workers.filter((w) => !w.url.includes('editor.worker') && !w.closed)).toHaveLength(1);
  await page.getByRole('button', {name: 'R', exact: true}).click();
  await expect(page.getByRole('alert').filter({hasText: 'SOURCE_UNAVAILABLE'})).toContainText(
    'MIME text/html',
  );
  expect(workers.filter((w) => w.url.includes('webr'))).toHaveLength(0);
  blockR = false;
  await page.getByRole('button', {name: 'Hinweis schliessen'}).click();
  await page.getByRole('button', {name: 'R initialisieren', exact: true}).click();
  await expect(page.locator('.run-status')).toContainText('Bereit', {timeout: 90000});
  expect(workers.filter((w) => w.url.includes('webr') && !w.closed)).toHaveLength(1);
  await code(page, 'cat(6*7)');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.getByRole('log')).toContainText('42');
});
test('P7 AT-046 AT-068–069: R worker CSP failure times out, corrected retry and genuine loop cancellation', async ({
  page,
  baseURL,
}, info) => {
  const workers: {closed: boolean; url: string}[] = [];
  page.on('worker', (w) => {
    const rec = {closed: false, url: w.url()};
    workers.push(rec);
    w.on('close', () => {
      rec.closed = true;
    });
  });
  await page.route('**/runtime-config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    config.limits.rTimeoutMs = 60000;
    await route.fulfill({response, json: config});
  });
  let broken = true;
  await page.route('**/webr-worker.js', async (route) => {
    if (broken) {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'content-security-policy':
            "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'",
        },
      });
    } else await route.continue();
  });
  await start(page, baseURL!);
  await page.getByRole('button', {name: 'Neues R-Skript', exact: true}).click();
  await expect(page.getByRole('alert').filter({hasText: 'TIMEOUT'})).toBeVisible({timeout: 75000});
  await expect
    .poll(() => workers.filter((w) => w.url.includes('webr') && !w.closed).length)
    .toBe(0);
  broken = false;
  await page.getByRole('button', {name: 'Hinweis schliessen'}).click();
  await page.getByRole('button', {name: 'R initialisieren', exact: true}).click();
  await expect(page.locator('.run-status')).toContainText('Bereit', {timeout: 90000});
  await code(page, 'repeat { 1+1 }');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.run-status option').filter({hasText: 'running'})).toHaveCount(1);
  // captureR buffers console output until completion. Allow the posted loop to enter
  // the worker before cancelling; cancelling the preceding metadata commit is different.
  await page.waitForTimeout(1000);
  const cancelStarted = Date.now();
  await page.getByRole('button', {name: 'Abbrechen', exact: true}).click();
  await expect(page.getByRole('alert').filter({hasText: 'CANCELLED'})).toBeVisible();
  expect(Date.now() - cancelStarted).toBeLessThan(10000);
  await expect
    .poll(() => workers.filter((w) => w.url.includes('webr') && !w.closed).length)
    .toBe(info.project.metadata.profile === 2 ? 1 : 0); // Real SAB interrupt, without reset, is proved by the same live worker.
  await code(page, 'cat("nach Abbruch")');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.getByRole('log')).toContainText('nach Abbruch', {timeout: 90000});
});
