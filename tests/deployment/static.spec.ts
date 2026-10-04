import {test, expect} from './fixture';
import type {Page} from '@playwright/test';
async function code(page: Page, value: string) {
  await page.locator('.monaco-editor').click();
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+a');
  await page.keyboard.insertText(value);
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+s');
}
test('P7 AT-066–068: arbitrary UID static container, deep routes, MIME/cache/CSP and real SQL/R', async ({
  page,
  request,
  baseURL,
}, info) => {
  const violations: string[] = [],
    network: string[] = [],
    errors: string[] = [];
  await page.addInitScript(() => {
    Reflect.set(globalThis, 'cspViolations', []);
    document.addEventListener('securitypolicyviolation', (e) => {
      (Reflect.get(globalThis, 'cspViolations') as string[]).push(
        `${e.effectiveDirective}: ${e.blockedURI}`,
      );
    });
  });
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const config = await request.get(`${baseURL}runtime-config.json`);
  expect(config.status()).toBe(200);
  expect(config.headers()['content-type']).toContain('application/json');
  expect(config.headers()['cache-control']).toBe('no-cache');
  expect(config.headers()['content-security-policy']).toContain(
    "script-src 'self' 'wasm-unsafe-eval'",
  );
  for (const path of [
    'missing.js',
    'vendor/missing.wasm',
    'vendor/webr-packages/missing.tgz',
    'missing/runtime-config.json',
  ]) {
    const r = await request.get(`${baseURL}${path}`);
    expect(r.status()).toBe(404);
    expect(await r.text()).not.toContain('<!doctype html>');
  }
  const wasm = await request.get(`${baseURL}vendor/duckdb/1.33.1-dev57.0/duckdb-eh.wasm`, {
    headers: {Range: 'bytes=0-15'},
  });
  expect(wasm.status()).toBe(206);
  expect(wasm.headers()['content-type']).toBe('application/wasm');
  expect(wasm.headers()['content-range']).toMatch(/^bytes 0-15\//);
  expect(wasm.headers()['cache-control']).toContain('immutable');
  expect((await wasm.body()).length).toBe(16);
  await page.goto(`${baseURL}workspaces`);
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Statische Prüfung');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await code(page, 'SELECT 42 AS wert');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.result-grid tbody td')).toHaveText(['42']);
  await page.getByRole('button', {name: 'Aufbewahren', exact: true}).click();
  await expect(page.getByText('1 Zeilen · vollständig · aufbewahrt', {exact: true})).toBeVisible();
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.locator('.result-grid tbody td')).toHaveText(['42']);
  expect(page.url()).toBe(url);
  await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
  await page.getByRole('button', {name: 'Neues R-Skript', exact: true}).click();
  await code(
    page,
    'x <- data.frame(n=42L); stopifnot(as.Date("2024-01-01")==as.Date(19723,origin="1970-01-01")); plot(1:4); cat("R bereit")',
  );
  await expect(page.locator('.run-status')).toContainText('Bereit', {timeout: 90000});
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.r-plot img')).toBeVisible({timeout: 90000});
  await expect(page.getByRole('log')).toContainText('R bereit');
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(info.project.metadata.profile === 2);
  expect(
    await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((x) => x.length)),
  ).toBe(0);
  violations.push(
    ...(await page.evaluate(() => Reflect.get(globalThis, 'cspViolations') as string[])),
  );
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
  expect(network.every((url) => new URL(url).origin === new URL(baseURL!).origin)).toBe(true);
  await info.attach('network', {
    body: JSON.stringify(network, null, 2),
    contentType: 'application/json',
  });
});

test('P7 AT-067: invalid operator config fails closed before any runtime', async ({
  page,
  baseURL,
}) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.route('**/runtime-config.json', (route) =>
    route.fulfill({json: {formatVersion: 99, allowedDataOrigins: ['*']}}),
  );
  await page.goto(`${baseURL}workspaces`);
  await expect(page.getByText(/Konfiguration ungültig/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true})).toHaveCount(
    0,
  );
  expect(workers).toEqual([]);
});
