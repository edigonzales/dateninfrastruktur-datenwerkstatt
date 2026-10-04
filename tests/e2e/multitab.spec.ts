import {test, expect} from '../persistentBrowser';
test('P6 AT-065: absent Web Locks permits existing project only as reader, archive export remains possible', async ({
  page,
  context,
}) => {
  await page.goto('/workspaces');
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Ohne Locks');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Ohne Locks', exact: true})).toBeVisible();
  const url = page.url();
  await page.getByLabel('Beschreibung', {exact: true}).fill('Dauerhafter Stand');
  await page.getByRole('button', {name: 'Speichern', exact: true}).click();
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toBeVisible();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', {value: undefined, configurable: true});
  });
  await page.reload();
  await page.getByRole('button', {name: 'Gesicherte Projekte nur lesen'}).click();
  await expect(page.getByText(/Nur lesend/)).toBeVisible();
  await expect(page.getByLabel('Beschreibung', {exact: true})).toBeDisabled();
  await expect(page.getByLabel('Beschreibung', {exact: true})).toHaveValue('Dauerhafter Stand');
  await expect(page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true})).toBeDisabled();
  await expect(
    page.getByRole('button', {name: 'Arbeitsbereich löschen', exact: true}),
  ).toBeDisabled();
  await page.getByRole('button', {name: 'Projekt exportieren', exact: true}).click();
  await page.getByLabel('Archivmodus').selectOption('recipe');
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Archiv herunterladen'}).click();
  await download;
  const next = await context.newPage();
  await next.goto(url);
  await next.getByRole('button', {name: 'Nur diese Sitzung verwenden'}).click();
  await expect(next).toHaveURL(/\/workspaces$/);
  await next.getByLabel('Name des neuen Arbeitsbereichs').fill('Temporär');
  await next.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await expect(next.getByText('Nur diese Sitzung · kein Backup', {exact: true})).toBeVisible();
});
