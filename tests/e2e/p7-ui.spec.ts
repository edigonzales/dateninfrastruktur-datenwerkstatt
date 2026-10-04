import {test, expect} from '../persistentBrowser';
import {mkdir, writeFile} from 'node:fs/promises';
import type {Page} from '@playwright/test';
async function create(page: Page) {
  await page.goto('/workspaces');
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('P7 Arbeitsfläche');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
}
async function enter(page: Page, text: string) {
  await page.locator('.monaco-editor').click();
  const input = page.getByRole('textbox', {name: 'Analysecode'});
  await input.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await input.press('ControlOrMeta+s');
}
test('P7 AT-054–055 AT-058: measured SQL/R geometry, keyboard splitters, layout reset and reload', async ({
  page,
}, info) => {
  await page.setViewportSize({width: 1440, height: 900});
  await create(page);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await enter(page, 'SELECT 77 AS wert');
  await page.getByRole('textbox', {name: 'Analysecode'}).press('ControlOrMeta+Enter');
  await expect(page.locator('.result-grid tbody td')).toHaveText(['77']);
  const sqlUrl = page.url();
  const geometry = [];
  for (const kind of ['sql', 'r']) {
    if (kind === 'r') {
      await page.getByRole('button', {name: 'R', exact: true}).click();
      await expect(page.locator('.run-status')).toContainText('Bereit', {timeout: 60000});
      await enter(page, 'plot(1:4); cat("Gemessene R-Ausgabe")');
      await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
      await expect(page.locator('.r-plot img')).toBeVisible();
      await expect(page.getByRole('log')).toContainText('Gemessene R-Ausgabe');
      await page.getByRole('button', {name: 'Objekte / Eingaben'}).click();
    }
    for (const size of [
      {width: 1440, height: 900},
      {width: 1280, height: 800},
    ]) {
      await page.setViewportSize(size);
      await expect(page.locator('.code-editor')).toBeVisible();
      const box = await page.evaluate((kind) => {
        const rect = (selector: string) => {
          const b = document.querySelector(selector)!.getBoundingClientRect();
          return {x: b.x, y: b.y, width: b.width, height: b.height, bottom: b.bottom};
        };
        return {
          kind,
          viewport: {width: innerWidth, height: innerHeight},
          header: rect('header'),
          sidebar: rect('.sidebar'),
          toolbar: rect('.analysis-toolbar'),
          editor: rect('.code-editor'),
          area: rect(kind === 'sql' ? '.sql-panels' : '.r-panels'),
          output: rect(kind === 'sql' ? '.result-section' : '.r-output'),
          scrollWidth: document.documentElement.scrollWidth,
        };
      }, kind);
      expect(box.header.height).toBe(56);
      expect(box.sidebar.width).toBe(52);
      expect(box.toolbar.height).toBeLessThanOrEqual(88);
      expect(box.area.height).toBeGreaterThanOrEqual(size.height * 0.75);
      expect(box.area.width).toBeGreaterThanOrEqual((size.width - box.sidebar.width) * 0.9);
      expect(box.scrollWidth).toBeLessThanOrEqual(size.width);
      expect(box.area.bottom).toBeLessThanOrEqual(size.height + 1);
      if (kind === 'sql' && size.height === 900) {
        expect(box.editor.height).toBeGreaterThanOrEqual(180);
        expect(box.output.height).toBeGreaterThanOrEqual(220);
      }
      geometry.push(box);
      await mkdir('docs/verification', {recursive: true});
      await page.screenshot({
        path: `docs/verification/p7-${kind}-${info.project.name}-${size.width}.png`,
      });
    }
    const splitter = page.getByRole('separator', {
      name:
        kind === 'sql' ? 'Grösse von Editor und Resultat ändern' : 'R Editor und Ausgabe teilen',
    });
    await splitter.focus();
    const before = await splitter.getAttribute('aria-valuenow');
    await splitter.press(kind === 'sql' ? 'ArrowDown' : 'ArrowRight');
    await expect(splitter).not.toHaveAttribute('aria-valuenow', before!);
    const changed = await splitter.getAttribute('aria-valuenow');
    // Await actual separate view storage, not an arbitrary delay.
    await expect
      .poll(() =>
        page.evaluate(async (kind) => {
          const p = '/src/app/services.ts';
          const {services} = (await import(p)) as typeof import('../../src/app/services');
          const id = location.pathname.split(
            '/',
          )[2] as import('../../src/domain/model').WorkspaceId;
          const v = await services.views.load(id);
          return Math.round((kind === 'sql' ? v.sqlEditorFraction : v.rEditorFraction) * 100);
        }, kind),
      )
      .toBe(Number(changed));
    await page.reload();
    await expect(splitter).toHaveAttribute('aria-valuenow', changed!);
    await page.getByRole('button', {name: 'Arbeitsfläche zurücksetzen'}).click();
    await expect(splitter).toHaveAttribute('aria-valuenow', kind === 'sql' ? '45' : '50');
  }
  await writeFile(
    `docs/verification/p7-geometry-${info.project.name}.json`,
    JSON.stringify(geometry, null, 2),
  );
  await page.getByRole('button', {name: 'Konsole', exact: true}).click();
  await expect(page.getByRole('log')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('log')).toHaveCount(0);
  await page.getByRole('button', {name: 'SQL', exact: true}).click();
  expect(page.url()).toBe(sqlUrl);
});
test('P7 AT-055–057: native focus trap/return, settings, storage cleanup and data-free diagnostics', async ({
  page,
}) => {
  await create(page);
  const open = page.getByRole('button', {name: 'Datei hinzufügen', exact: true});
  await open.click();
  const dialog = page.getByRole('dialog', {name: 'Datei importieren'});
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await enter(page, "SELECT 'PRIVATE_CODE_MARKER' AS wert");
  await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
  await page.getByText('Lokale Diagnose', {exact: true}).click();
  let downloaded = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Diagnosebericht herunterladen'}).click();
  let path = await (await downloaded).path();
  const {readFile} = await import('node:fs/promises');
  expect(await readFile(path!, 'utf8')).not.toContain('PRIVATE_CODE_MARKER');
  await page.getByLabel('Analysecode ausdrücklich aufnehmen').check();
  downloaded = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Diagnosebericht herunterladen'}).click();
  path = await (await downloaded).path();
  expect(await readFile(path!, 'utf8')).toContain('PRIVATE_CODE_MARKER');
  await page.getByRole('link', {name: 'Einstellungen', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Browser-Speicher'})).toContainText(
    'Geschätzter Verbrauch',
  );
  await page.getByLabel('Seitenleiste standardmässig eingeklappt').uncheck();
  await expect(page.getByRole('status')).toHaveText('Einstellungen gespeichert');
  await page.reload();
  await expect(page.getByLabel('Seitenleiste standardmässig eingeklappt')).not.toBeChecked();
  await page.getByRole('button', {name: 'Nicht referenzierte Projektreste bereinigen'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {name: 'Nicht referenzierte Projektreste bereinigen'}),
  ).toBeFocused();
  await expect(page.getByText(/Login|ClickHouse|Freigaben|KI-Assistent/)).toHaveCount(0);
});

test('P7 AT-025 AT-055 AT-056: selected SQL is snapshotted and cell markup remains text', async ({
  page,
}) => {
  await create(page);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await enter(page, 'SELECT absent FROM absent_table;\nSELECT 42 AS selected');
  const editor = page.getByRole('textbox', {name: 'Analysecode'});
  await editor.press('ControlOrMeta+End');
  await editor.press('Home');
  await editor.press('Shift+End');
  await editor.press('ControlOrMeta+Enter');
  await expect(page.locator('.result-grid tbody td')).toHaveText(['42']);
  const snapshot = await page.evaluate(async () => {
    const p = '/src/app/services.ts';
    const {services} = (await import(p)) as typeof import('../../src/app/services');
    const session = await services.workspaces.open(location.pathname.split('/')[2]!);
    return Object.values(session.document.runs).at(-1)!.snapshot.code;
  });
  expect(snapshot).toBe('SELECT 42 AS selected');
  const marker = '<img src=x onerror="globalThis.p7XSS=1">';
  await enter(page, `SELECT '${marker}' AS text`);
  await page.getByRole('button', {name: 'Ausführen', exact: true}).click();
  await expect(page.locator('.result-grid tbody td')).toHaveText([marker]);
  expect(await page.evaluate(() => Reflect.get(globalThis, 'p7XSS'))).toBeUndefined();
  expect(await page.locator('.result-grid img, .result-grid script').count()).toBe(0);
});

test('P7 AT-058: browser history restores the analysis cursor and layout does not edit the domain', async ({
  page,
}) => {
  await create(page);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await enter(page, 'SELECT 11 AS wert');
  const sqlUrl = page.url();
  const editor = page.getByRole('textbox', {name: 'Analysecode'});
  await editor.press('Home');
  for (let i = 0; i < 7; i++) await editor.press('ArrowRight');
  const position = () =>
    page.evaluate(async () => {
      const path = '/src/infrastructure/monaco/runtime.ts';
      const {monaco} = (await import(
        path
      )) as typeof import('../../src/infrastructure/monaco/runtime');
      return monaco.editor.getEditors()[0]!.getPosition();
    });
  expect(await position()).toEqual({lineNumber: 1, column: 8});
  await page.getByRole('button', {name: 'R', exact: true}).click();
  const rUrl = page.url();
  await expect(page.locator('.r-workbench')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(sqlUrl);
  await expect(editor).toBeFocused();
  expect(await position()).toEqual({lineNumber: 1, column: 8});
  await page.keyboard.insertText('9');
  await expect(page.locator('.view-lines')).toContainText(/SELECT\s+911\s+AS\s+wert/);
  await editor.press('ControlOrMeta+z');
  await expect(page.locator('.view-lines')).toContainText(/SELECT\s+11\s+AS\s+wert/);
  await editor.press('ControlOrMeta+s');
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(rUrl);
  await page.goBack();
  await expect(page).toHaveURL(sqlUrl);
  const state = () =>
    page.evaluate(async () => {
      const p = '/src/app/services.ts';
      const {services} = (await import(p)) as typeof import('../../src/app/services');
      const session = await services.workspaces.open(location.pathname.split('/')[2]!);
      await session.flush();
      return {revision: session.document.revision, runs: Object.keys(session.document.runs)};
    });
  const before = await state();
  const splitter = page.getByRole('separator', {name: 'Grösse von Editor und Resultat ändern'});
  await splitter.focus();
  await splitter.press('ArrowDown');
  await page.getByRole('button', {name: 'Arbeitsfläche zurücksetzen'}).click();
  expect(await state()).toEqual(before);
  expect(before.runs).toEqual([]);
});
