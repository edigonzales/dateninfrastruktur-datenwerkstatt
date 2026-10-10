import {test, expect} from '../persistentBrowser';
import {mkdir, writeFile} from 'node:fs/promises';
import type {Locator, Page} from '@playwright/test';
const evidence = 'docs/verification/design-system';
// DOMRect subtraction in Firefox can differ by less than 0.0001 CSS px.
// Assert geometry to 0.005 px; the CSS spacing contract stays exactly 8 px.
async function gaps(group: Locator) {
  return group.locator(':scope > button').evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return {left: r.left, right: r.right, top: r.top, bottom: r.bottom};
    }),
  );
}
async function capture(page: Page, name: string) {
  await mkdir(evidence, {recursive: true});
  await page.screenshot({path: `${evidence}/${name}.png`, fullPage: true});
}
test('UI components: labels, native submit, checkbox, errors, busy state, menu and dialog keyboard', async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/tests/design-system/');
  const name = page.getByRole('textbox', {name: 'Projektname', exact: true});
  await name.fill('Referenzprojekt');
  await expect(name).toHaveAttribute('required');
  await expect(name).toHaveAccessibleDescription('Ein eindeutiger Name für das Projekt.');
  await page.getByText('Originaldatei behalten', {exact: true}).click();
  await expect(page.getByRole('checkbox', {name: 'Originaldatei behalten'})).toBeChecked();
  await expect(page.getByRole('textbox', {name: /Ein langes Label/})).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('textbox', {name: /Ein langes Label/})).toHaveAccessibleDescription(
    /Der angegebene Name/,
  );
  await page.getByRole('button', {name: 'Vorschau', exact: true}).click();
  await expect(page.getByLabel('Formularstatus')).toHaveText('0 gesendet');
  await page.getByRole('button', {name: 'Formular senden'}).click();
  await expect(page.getByLabel('Formularstatus')).toHaveText('1 gesendet');
  await expect(page.getByRole('button', {name: 'Wird gespeichert'})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Wird gespeichert'})).toHaveAttribute(
    'aria-busy',
    'true',
  );
  const trigger = page.getByRole('button', {name: 'Weitere Aktionen'});
  await trigger.focus();
  await trigger.press('ArrowUp');
  await expect(page.getByRole('menuitem', {name: 'Letzte Aktion'})).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('menuitem', {name: 'Erste Aktion'})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', {name: 'Letzte Aktion'})).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Aktionsstatus')).toHaveText('Erste Aktion');
  const open = page.getByRole('button', {name: 'Dialog öffnen'});
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  const buttons = await gaps(dialog.locator('.dw-dialog-footer'));
  expect(buttons[1]!.left - buttons[0]!.right).toBeCloseTo(8, 2);
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  const sql = page.getByRole('button', {name: 'SQL', exact: true});
  await sql.focus();
  await expect(page.getByRole('tooltip', {name: 'SQL · DuckDB'})).toBeVisible();
  await expect(sql).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip', {name: 'SQL · DuckDB'})).not.toBeVisible();
  await page.getByRole('button', {name: 'R', exact: true}).hover();
  await expect(page.getByRole('tooltip', {name: 'R · webR'})).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => [...document.fonts].find((font) => font.family.includes('JetBrains Mono'))?.status,
    ),
  ).toBe('loaded');
  expect(
    await page.evaluate(() =>
      [...document.fonts]
        .filter((font) => font.family.includes('Frutiger'))
        .map((font) => ({weight: font.weight, status: font.status}))
        .sort((a, b) => a.weight.localeCompare(b.weight)),
    ),
  ).toEqual([
    {weight: '400', status: 'loaded'},
    {weight: '700', status: 'loaded'},
  ]);
  expect(
    await page
      .locator('body')
      .evaluate((el) => getComputedStyle(el).fontFamily.split(',')[0]?.replaceAll('"', '').trim()),
  ).toBe('Frutiger');
  expect(
    requests.filter((url) => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173/')),
  ).toEqual([]);
  expect(requests.filter((url) => /duckdb|webr\/|workspaceService/.test(url))).toEqual([]);
  await capture(page, `components-${info.project.name}`);
});
test('UI geometry: 8 px wrapped actions, form labels, narrow/zoom equivalent and failed local font', async ({
  page,
}, info) => {
  await page.route('**/*.woff2', (route) => route.abort());
  await page.goto('/tests/design-system/');
  const measurements = [];
  for (const size of [
    {width: 1440, height: 900},
    {width: 1280, height: 800},
    {width: 720, height: 450},
  ]) {
    await page.setViewportSize(size);
    const rects = await gaps(page.getByTestId('wrapped-actions'));
    let wrapped = false;
    for (let i = 1; i < rects.length; i++) {
      const previous = rects[i - 1]!,
        current = rects[i]!;
      if (current.top === previous.top) expect(current.left - previous.right).toBeCloseTo(8, 2);
      else {
        wrapped = true;
        expect(current.top - previous.bottom).toBeCloseTo(8, 2);
      }
    }
    expect(wrapped).toBe(true);
    const label = await page
      .getByRole('textbox', {name: 'Projektname', exact: true})
      .evaluate((el) => {
        const field = el.parentElement!,
          label = field.querySelector('label')!,
          style = getComputedStyle(label);
        return {
          gap: el.getBoundingClientRect().top - label.getBoundingClientRect().bottom,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          inputHeight: el.getBoundingClientRect().height,
          background: getComputedStyle(document.body).backgroundColor,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
    expect(label).toMatchObject({
      fontSize: '14px',
      fontWeight: '700',
      background: 'rgb(255, 255, 255)',
    });
    expect(label.gap).toBeCloseTo(8, 2);
    expect(label.inputHeight).toBeGreaterThanOrEqual(40);
    expect(label.scrollWidth).toBeLessThanOrEqual(size.width);
    measurements.push({size, label, rects});
    await capture(page, `components-${info.project.name}-${size.width}-fallback`);
  }
  // WebKit recreates CSS FontFaces after resizing, resetting failed faces to
  // "unloaded". Explicitly load the current faces to verify the actual failure.
  expect(
    await page.evaluate(async () =>
      Promise.all(
        [...document.fonts].map(async (font) => ({
          family: font.family.replaceAll('"', ''),
          weight: font.weight,
          outcome: await font.load().then(
            () => 'loaded',
            () => 'rejected',
          ),
          status: font.status,
        })),
      ),
    ),
  ).toEqual([
    {family: 'Frutiger', weight: '400', outcome: 'rejected', status: 'error'},
    {family: 'Frutiger', weight: '700', outcome: 'rejected', status: 'error'},
    {family: 'JetBrains Mono', weight: '400', outcome: 'rejected', status: 'error'},
  ]);
  for (const name of ['Frutiger 400', 'Frutiger 700', 'JetBrains Mono 400'])
    await expect(page.getByLabel(`Fontstatus ${name}`)).toContainText('Systemfont-Fallback');
  await writeFile(
    `${evidence}/components-${info.project.name}.json`,
    JSON.stringify(measurements, null, 2),
  );
});
test('UI screens: project actions, forms, navigation and settings at target viewports', async ({
  page,
}, info) => {
  await page.goto('/workspaces');
  await expect(page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true})).toHaveClass(
    /dw-button--primary/,
  );
  await expect(page.getByRole('button', {name: 'Projekt öffnen', exact: true})).toHaveClass(
    /dw-button--secondary/,
  );
  await capture(page, `overview-${info.project.name}`);
  await page
    .getByLabel('Name des neuen Arbeitsbereichs')
    .fill('Designsystem – Prüfung mit einem langen Projektnamen');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  for (const size of [
    {width: 1440, height: 900},
    {width: 1280, height: 800},
  ]) {
    await page.setViewportSize(size);
    await expect(page.locator('.sidebar [aria-current="page"]')).toHaveCount(1);
    const actions = await gaps(page.locator('.archive-actions > .dw-actions > .dw-actions'));
    for (let i = 1; i < actions.length; i++)
      if (actions[i]!.top === actions[i - 1]!.top)
        expect(actions[i]!.left - actions[i - 1]!.right).toBeCloseTo(8, 2);
    await capture(page, `project-${info.project.name}-${size.width}`);
    await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, `import-${info.project.name}-${size.width}`);
    await page.keyboard.press('Escape');
  }
  await expect(page.locator('.sidebar svg')).toHaveCount(6);
  await page.getByRole('button', {name: 'Navigation ausklappen'}).click();
  expect((await page.locator('.sidebar').boundingBox())!.width).toBe(212);
  await page.getByRole('link', {name: 'Einstellungen', exact: true}).click();
  for (const size of [
    {width: 1440, height: 900},
    {width: 1280, height: 800},
  ]) {
    await page.setViewportSize(size);
    await capture(page, `settings-${info.project.name}-${size.width}`);
  }
});
