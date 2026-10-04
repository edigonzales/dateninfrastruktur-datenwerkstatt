import {test, expect} from '../persistentBrowser';
import {setupPortal, portalConfig} from '../portal/setup';
test('P4 AT-038 AT-056: explicit deep-link preview, replacement history and no autorun', async ({
  page,
  request,
  context,
}) => {
  await setupPortal(page, request);
  await context.addCookies([
    {name: 'secret', value: 'must-not-send', url: 'http://127.0.0.1:4174/'},
  ]);
  await page.route('**/runtime-config.json', (route) => route.fulfill({json: portalConfig}));
  await page.goto('/workspaces');
  await page.goto('/open?provider=fixture&series=serie&issue=current&table=main');
  await expect(page.getByLabel('Portaltabelle')).toHaveCount(1);
  await page.getByRole('button', {name: 'Portalvorschau laden'}).click();
  await expect(page.getByRole('cell', {name: '001', exact: true})).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(globalThis, 'marker'))).toBeUndefined();
  await page.getByRole('button', {name: 'Portalimport bestätigen'}).click();
  await expect(page).toHaveURL(/\/workspaces\/[^/]+\/data$/);
  await expect(page.getByText('data.portal_daten', {exact: true})).toHaveCount(1);
  await page.reload();
  await expect(page.getByText('data.portal_daten', {exact: true})).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/workspaces$/);
  await page.goForward();
  await expect(page.getByText('data.portal_daten', {exact: true})).toHaveCount(1);
  await page.getByRole('button', {name: 'Lokal sichern', exact: true}).click();
  await expect(
    page.getByText('Lokal gesichert · Hash beim Import geprüft', {exact: false}),
  ).toBeVisible();
  await request.post('http://127.0.0.1:4174/__change');
  await page.reload();
  await page.getByRole('button', {name: 'Daten ansehen'}).click();
  await expect(page.getByRole('cell', {name: '001', exact: true})).toBeVisible();
  const requests = (await (await request.get('http://127.0.0.1:4174/__requests')).json()) as {
    cookie: string | null;
    path: string;
  }[];
  expect(requests.filter((r) => !r.path.startsWith('/__')).every((r) => r.cookie === null)).toBe(
    true,
  );
  await page.goto('/open?provider=fixture&dataset=x&r=globalThis.marker');
  await expect(page.getByRole('alert')).toContainText('unerlaubte');
});
