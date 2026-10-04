import {expect, test} from '../persistentBrowser';
import type {Page} from '@playwright/test';
async function create(page: Page, name = 'Beispielanalyse') {
  await page.goto('/workspaces');
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill(name);
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await expect(page.getByRole('heading', {name, exact: true})).toBeVisible();
}
test('AT-003: workspace metadata persists across reload without engine startup', async ({page}) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await create(page);
  const url = page.url();
  await page
    .getByLabel('Beschreibung', {exact: true})
    .fill('Lokale Auswertung mit führenden Nullen.');
  await page.getByLabel('Projektname', {exact: true}).fill('Öffentliche Auswertung');
  await page.getByRole('button', {name: 'Speichern', exact: true}).click();
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Beschreibung', {exact: true})).toHaveValue(
    'Lokale Auswertung mit führenden Nullen.',
  );
  await expect(page.getByLabel('Projektname', {exact: true})).toHaveValue('Öffentliche Auswertung');
  expect(page.url()).toBe(url);
  expect(workers).toHaveLength(0);
});
test('AT-005 AT-058: saved SQL and R, separate models, duplicate, archive, no code auto-run', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await create(page);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await page.getByLabel('Analysename', {exact: true}).fill('Kennzahlen');
  await page.getByRole('button', {name: 'Speichern', exact: true}).click();
  const sqlUrl = page.url();
  const code = page.getByRole('textbox', {name: 'Analysecode'});
  await page.locator('.monaco-editor').click();
  await code.press('ControlOrMeta+a');
  await expect(page.locator('.selected-text').first()).toBeVisible();
  await page.keyboard.insertText('SELECT 42 AS wert;');
  await expect(page.locator('.view-lines')).toHaveText(/^SELECT\s+42\s+AS\s+wert;$/);
  await code.press('ControlOrMeta+s');
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toBeVisible();
  await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
  await page.getByRole('button', {name: 'Neues R-Skript', exact: true}).click();
  await page.locator('.monaco-editor').click();
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+a');
  await expect(page.locator('.selected-text').first()).toBeVisible();
  await page.keyboard.insertText('stop("Dieser Code darf beim Öffnen nicht laufen")');
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+s');
  await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
  await page.getByRole('link', {name: 'Kennzahlen', exact: true}).click();
  await expect(page.locator('.monaco-editor')).toContainText('SELECT');
  await expect(page.locator('.monaco-editor')).toContainText('42');
  // WebKit insertText emits per-character input, so native Monaco undo groups words.
  // Verify the same complete history, without assuming a browser-specific group count.
  const originalCode = /^SELECT\s+1\s+AS\s+wert;$/;
  let undoSteps = 0;
  while (!originalCode.test(await page.locator('.view-lines').innerText()) && undoSteps < 10) {
    const before = await page.locator('.view-lines').innerText();
    await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+z');
    await expect.poll(() => page.locator('.view-lines').innerText()).not.toBe(before);
    undoSteps++;
  }
  expect(undoSteps).toBeGreaterThan(0);
  await expect(page.locator('.view-lines')).toContainText(originalCode);
  for (let step = 0; step < undoSteps; step++) {
    const before = await page.locator('.view-lines').innerText();
    await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+Shift+z');
    await expect.poll(() => page.locator('.view-lines').innerText()).not.toBe(before);
  }
  await expect(page.locator('.view-lines')).toContainText(/SELECT\s+42\s+AS\s+wert;/);
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+s');
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toBeVisible();
  await page.reload();
  await expect(page.locator('.monaco-editor')).toContainText('42');
  expect(page.url()).toBe(sqlUrl);
  await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
  const item = page
    .locator('li')
    .filter({has: page.getByRole('link', {name: 'Kennzahlen', exact: true})});
  await item.getByRole('button', {name: 'Duplizieren', exact: true}).click();
  await expect(page.getByRole('link', {name: 'Kennzahlen (Kopie)', exact: true})).toBeVisible();
  await item.getByRole('button', {name: 'Archivieren', exact: true}).click();
  await expect(page.getByRole('link', {name: 'Kennzahlen', exact: true})).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('AT-012: another tab opens read-only and explicitly reacquires after writer closes', async ({
  page,
  context,
}) => {
  await create(page);
  const url = page.url();
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByText(/Nur lesend/)).toBeVisible();
  await expect(other.getByLabel('Beschreibung', {exact: true})).toBeDisabled();
  await expect(other.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true})).toBeDisabled();
  await page.getByLabel('Beschreibung', {exact: true}).fill('Neuer Stand');
  await page.getByRole('button', {name: 'Speichern', exact: true}).click();
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toBeVisible();
  await page.close();
  await other.getByRole('button', {name: 'Schreibrecht erneut anfordern'}).click();
  await expect(other.getByLabel('Beschreibung', {exact: true})).toBeEnabled();
  await expect(other.getByLabel('Beschreibung', {exact: true})).toHaveValue('Neuer Stand');
});
test('AT-054 AT-057 partial: compact chrome and implemented settings persist', async ({
  page,
}, info) => {
  await page.setViewportSize({width: 1440, height: 900});
  await create(page);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await expect(page.locator('.code-editor')).toBeVisible();
  await expect(page.locator('.view-lines')).toContainText('SELECT');
  const boxes = await page.evaluate(() => ({
    header: document.querySelector('header')!.getBoundingClientRect().height,
    sidebar: document.querySelector('.sidebar')!.getBoundingClientRect().width,
    editor: document.querySelector('.code-editor')!.getBoundingClientRect().height,
    result: document.querySelector('.result-section')!.getBoundingClientRect().height,
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(boxes.header).toBe(56);
  expect(boxes.sidebar).toBe(52);
  // P3 adds the required real result pane: REQ-064 measures editor + result area.
  expect(boxes.editor + boxes.result).toBeGreaterThanOrEqual(675);
  expect(boxes.width).toBe(boxes.viewport);
  await info.attach('p1-sql-layout', {body: await page.screenshot(), contentType: 'image/png'});
  await page.setViewportSize({width: 1280, height: 800});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', {name: 'Einstellungen', exact: true}).click();
  await page.getByLabel('Editor-Schriftgrösse').selectOption('18');
  await page.getByLabel('Zeilenumbruch', {exact: true}).check();
  await expect(page.getByRole('status')).toHaveText('Einstellungen gespeichert');
  await page.reload();
  await expect(page.getByLabel('Editor-Schriftgrösse')).toHaveValue('18');
  await expect(page.getByLabel('Zeilenumbruch', {exact: true})).toBeChecked();
  await expect(page.getByText(/Login|ClickHouse|Freigaben|KI-Assistent/)).toHaveCount(0);
});
test('AT-058 / REQ-060: invalid workspace/analysis route is controlled', async ({page}) => {
  await create(page);
  const url = page.url();
  await page.goto(`${url}/sql/00000000-0000-4000-8000-000000000001`);
  await expect(page.getByRole('heading', {name: 'Analyse nicht gefunden'})).toBeVisible();
  await page.goto('/workspaces/not-a-uuid');
  await expect(
    page.getByRole('heading', {name: 'Projekt konnte nicht geöffnet werden'}),
  ).toBeVisible();
});
