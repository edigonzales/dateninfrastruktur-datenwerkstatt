import {expect, test} from '../persistentBrowser';
import type {Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function editor(page: Page, code: string) {
  const input = page.getByRole('textbox', {name: 'Analysecode'});
  await page.locator('.monaco-editor').click();
  await input.press('ControlOrMeta+a');
  await expect(page.locator('.selected-text').first()).toBeVisible();
  await page.keyboard.insertText(code);
  await input.press('ControlOrMeta+s');
}
async function workspace(page: Page) {
  await page.goto('/workspaces');
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('SQL Werkstatt');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
}
test('P3 / AT-022 AT-027 AT-032 AT-049 AT-055 AT-058: SQL, paging, keep, exports, chart, resize and reload', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({width: 1440, height: 900});
  await workspace(page);
  await editor(page, 'SELECT i, random() AS r FROM range(350) t(i)');
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+Enter');
  await expect(page.getByText('350 Zeilen · vollständig · temporär', {exact: true})).toBeVisible();
  await expect(page.locator('.result-grid tbody tr')).toHaveCount(100);
  const first = await page.locator('.result-grid tbody tr').first().innerText();
  await page.getByRole('button', {name: 'Nächste Seite'}).click();
  await expect(page.locator('.result-grid tbody tr').first().locator('td').first()).toHaveText(
    '100',
  );
  await page.getByRole('button', {name: 'Vorherige Seite'}).click();
  await expect(page.locator('.result-grid tbody tr').first()).toHaveText(first, {
    useInnerText: true,
  });
  await page.getByRole('button', {name: 'Aufbewahren', exact: true}).click();
  await expect(
    page.getByText('350 Zeilen · vollständig · aufbewahrt', {exact: true}),
  ).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name: 'CSV exportieren'}).click();
  const downloaded = await pending;
  const csv = await readFile((await downloaded.path())!, 'utf8');
  expect(csv.trim().split('\n')).toHaveLength(351);
  expect(csv).not.toContain('__dw_ordinal');
  const splitter = page.getByRole('separator', {name: 'Grösse von Editor und Resultat ändern'});
  const before = (await page.locator('.code-editor').boundingBox())!.height;
  await splitter.focus();
  await splitter.press('ArrowDown');
  await splitter.press('ArrowDown');
  const resized = (await page.locator('.code-editor').boundingBox())!.height;
  expect(resized).toBeGreaterThan(before);
  await page.getByRole('button', {name: 'Diagramm', exact: true}).click();
  await page.getByLabel('Diagrammtyp').selectOption('scatter');
  await expect(page.locator('canvas[role=img]')).toBeVisible();
  await page.getByRole('button', {name: 'Diagramm speichern', exact: true}).click();
  await expect(page.getByText('1 Diagramm(e) gespeichert', {exact: true})).toBeVisible();
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', {name: 'PNG exportieren'}).click();
  const png = await pngDownload;
  expect((await readFile((await png.path())!)).subarray(1, 4).toString()).toBe('PNG');
  await info.attach('sql-workspace', {body: await page.screenshot(), contentType: 'image/png'});
  await page.reload();
  await expect(
    page.getByText('350 Zeilen · vollständig · aufbewahrt', {exact: true}),
  ).toBeVisible();
  await expect(page.locator('.result-grid tbody tr').first()).toHaveText(first, {
    useInnerText: true,
  });
  expect(
    Math.abs((await page.locator('.code-editor').boundingBox())!.height - resized),
  ).toBeLessThan(3);
  expect(errors).toEqual([]);
});
test('P3 / AT-025 AT-030: parameters, explicit cancel and failed runs never show a previous output', async ({
  page,
}) => {
  await workspace(page);
  await page.getByText('Parameter (0)', {exact: true}).click();
  await page.getByRole('button', {name: 'Parameter hinzufügen'}).click();
  await page.getByLabel('Parameter 1 Name').fill('wert');
  await page.getByLabel('Parameter 1 Typ').selectOption('int64');
  await page.getByLabel('Parameter 1 Wert').fill('9007199254740993');
  await page.getByRole('button', {name: 'Parameter übernehmen'}).click();
  await editor(page, 'SELECT CAST($wert AS BIGINT) AS exact_value');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.result-grid tbody td')).toHaveText('9007199254740993');
  await editor(page, 'SELECT sum(a.i*b.i) FROM range(100000000) a(i), range(100000000) b(i)');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Abbrechen', exact: true})).toBeVisible();
  // Wait for the actual running state before cancellation, not initialization.
  await expect(page.locator('.result-toolbar').getByText(/Läuft · Revision/)).toBeVisible();
  await page.getByRole('button', {name: 'Abbrechen', exact: true}).click();
  await expect(page.locator('.result-toolbar').getByText(/Abgebrochen · Revision/)).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('.result-grid')).toHaveCount(0);
  await editor(page, 'SELECT 7 AS answer');
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.result-grid tbody td')).toHaveText('7');
  await editor(page, "SELECT * FROM read_csv('https://evil.invalid/x.csv')");
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.getByRole('alert').filter({hasText: 'SQL_NOT_ALLOWED'})).toBeVisible();
  await expect(page.locator('.result-grid')).toHaveCount(0);
});

test('P3 / AT-049: rendered bars and line gaps preserve NULL, PNG contains actual pixels', async ({
  page,
}, info) => {
  await workspace(page);
  await editor(
    page,
    'SELECT i AS x, CASE WHEN i = 1 THEN NULL ELSE i+1 END AS y FROM range(3) t(i) ORDER BY i DESC',
  );
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.getByText('3 Zeilen · vollständig · temporär', {exact: true})).toBeVisible();
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillRect;
    const line = CanvasRenderingContext2D.prototype.lineTo;
    const state: {bars: number[][]; lines: number[][]} = {bars: [], lines: []};
    Object.assign(globalThis, {chartProof: state});
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (this.canvas.getAttribute('role') === 'img') {
        if (w === 1000 && h === 480) {
          state.bars = [];
          state.lines = [];
        } else state.bars.push([x, y, w, h]);
      }
      return original.call(this, x, y, w, h);
    };
    CanvasRenderingContext2D.prototype.lineTo = function (x, y) {
      if (this.canvas.getAttribute('role') === 'img') state.lines.push([x, y]);
      return line.call(this, x, y);
    };
  });
  await page.getByRole('button', {name: 'Diagramm', exact: true}).click();
  await expect(page.locator('canvas[role=img]')).toBeVisible();
  const bars = await page.evaluate(
    () => (globalThis as typeof globalThis & {chartProof: {bars: number[][]}}).chartProof.bars,
  );
  expect(bars).toHaveLength(2);
  expect(bars[0]![0]).toBeLessThan(bars[1]![0]!);
  expect(bars[0]![3]).toBeGreaterThan(bars[1]![3]!);
  await page.evaluate(
    () =>
      ((globalThis as typeof globalThis & {chartProof: {lines: number[][]}}).chartProof.lines = []),
  );
  await page.getByLabel('Diagrammtyp').selectOption('line');
  await expect(page.locator('canvas[role=img]')).toHaveAttribute('aria-label', /line/);
  const proof = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[role=img]')!;
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      lines: (globalThis as typeof globalThis & {chartProof: {lines: number[][]}}).chartProof.lines,
      png: canvas.toDataURL(),
      ink: pixels.filter((v, i) => i % 4 !== 3 && v < 200).length,
    };
  });
  // Two axis segments only: the NULL point interrupts the data line.
  expect(proof.lines).toHaveLength(2);
  expect(proof.ink).toBeGreaterThan(1000);
  await info.attach('sql-line-null-gap', {
    body: Buffer.from(proof.png.split(',')[1]!, 'base64'),
    contentType: 'image/png',
  });
});
