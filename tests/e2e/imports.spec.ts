import {expect, test} from '../persistentBrowser';
import type {Page} from '@playwright/test';
async function create(page: Page) {
  await page.goto('/workspaces');
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Importprojekt');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Importprojekt', exact: true})).toBeVisible();
}
async function importCsv(page: Page) {
  await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
  await page
    .getByLabel('Datei (CSV oder Parquet, maximal 128 MiB)')
    .setInputFiles('fixtures/csv-edge-cases.csv');
  await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Import bestätigen'})).toBeEnabled();
  await expect(page.getByLabel('Typ 1', {exact: true})).toHaveValue('VARCHAR');
  await page.getByRole('button', {name: 'Import bestätigen'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('P2 / AT-008 AT-010 AT-018: confirmed import, reload, data preview, independent alias and complete Parquet download', async ({
  page,
}) => {
  await create(page);
  await importCsv(page);
  await expect(page.getByText('data.csv_edge_cases', {exact: true})).toBeVisible();
  await page.reload();
  await page.getByRole('button', {name: 'Daten ansehen', exact: true}).click();
  await expect(page.getByRole('cell', {name: '001', exact: true})).toBeVisible();
  await expect(page.getByRole('cell', {name: 'erste Zeile zweite Zeile'})).toBeVisible();
  await expect(page.getByRole('cell', {name: 'Leerstring', exact: true})).toHaveCount(2);
  await page.getByLabel('Anzeigename csv_edge_cases', {exact: true}).fill('Öffentliche Übersicht');
  await page.getByRole('button', {name: 'Speichern', exact: true}).click();
  await expect(page.getByText('data.csv_edge_cases', {exact: true})).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Parquet exportieren', exact: true}).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('csv_edge_cases.parquet');
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
  await page.getByLabel('Datei (CSV oder Parquet, maximal 128 MiB)').setInputFiles({
    name: 'csv-edge-cases.parquet',
    mimeType: 'application/vnd.apache.parquet',
    buffer: await (await import('node:fs/promises')).readFile(path!),
  });
  await expect(page.getByLabel('SQL-Name', {exact: true})).toHaveValue('csv_edge_cases_2');
  await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Import bestätigen'})).toBeEnabled();
  await page.getByRole('button', {name: 'Import bestätigen'}).click();
  await expect(page.getByText('data.csv_edge_cases_2', {exact: true})).toBeVisible();
});
test('P2 / AT-016: denied OPFS requires explicit temporary mode and never claims local persistence', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator.storage), 'getDirectory', {
      configurable: true,
      value: async () => {
        throw new DOMException('test denial', 'NotAllowedError');
      },
    });
  });
  await page.goto('/workspaces');
  await expect(page.getByRole('button', {name: 'Nur diese Sitzung verwenden'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true})).toHaveCount(
    0,
  );
  await page.getByRole('button', {name: 'Nur diese Sitzung verwenden'}).click();
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Temporär');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await importCsv(page);
  await expect(page.getByText('Lokal gespeichert · kein Backup', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Nur diese Sitzung · kein Backup', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Daten ansehen', exact: true}).click();
  await expect(page.getByRole('cell', {name: '001', exact: true})).toBeVisible();
});

test('P2 / AT-013: real import surfaces OPFS quota failure without publishing partial metadata', async ({
  page,
}) => {
  await create(page);
  await importCsv(page);
  await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
  await page
    .getByLabel('Datei (CSV oder Parquet, maximal 128 MiB)')
    .setInputFiles('fixtures/gemeinden.csv');
  await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Import bestätigen'})).toBeEnabled();
  await page.evaluate(() => {
    FileSystemFileHandle.prototype.createWritable = async () => {
      throw new DOMException('Injected disk full', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', {name: 'Import bestätigen'}).click();
  await expect(page.getByRole('alert').filter({hasText: 'Browser-Speicher voll'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Import bestätigen'})).toBeEnabled();
  await page.reload();
  await expect(page.getByText('data.csv_edge_cases', {exact: true})).toBeVisible();
  await expect(page.getByText('data.gemeinden', {exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Daten ansehen', exact: true}).click();
  await expect(page.getByRole('cell', {name: '001', exact: true})).toBeVisible();
});

test('P2 / AT-002 AT-024 partial: one import worker survives routes and closes before another workspace opens', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const engines = new Set<Worker>();
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      this: Worker,
      message: unknown,
      options?: Transferable[] | StructuredSerializeOptions,
    ) {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === 'INSTANTIATE'
      )
        engines.add(this);
      Reflect.apply(original, this, [message, options ?? []]);
    };
    Object.defineProperty(globalThis, '__testDuckDbWorkerCount', {get: () => engines.size});
  });
  const engineCount = () =>
    page.evaluate(() => {
      const count: unknown = Reflect.get(globalThis, '__testDuckDbWorkerCount');
      return count;
    });
  const workers: {closed: boolean}[] = [];
  page.on('worker', (worker) => {
    const state = {closed: false};
    workers.push(state);
    worker.on('close', () => {
      state.closed = true;
    });
  });
  await create(page);
  await importCsv(page);
  expect(await engineCount()).toBe(1);
  await page.getByRole('button', {name: 'Neue SQL-Abfrage', exact: true}).click();
  await page.getByRole('link', {name: 'Projektübersicht', exact: true}).click();
  await page.getByRole('button', {name: 'Daten ansehen', exact: true}).click();
  await expect(page.getByRole('cell', {name: '001', exact: true})).toBeVisible();
  expect(await engineCount()).toBe(1);
  await page.getByRole('link', {name: 'Arbeitsbereiche', exact: true}).click();
  await expect.poll(() => workers[0]?.closed).toBe(true);
  await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Leeres Projekt B');
  await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
  await expect(page.getByText('Noch keine Dateneinbindungen.', {exact: true})).toBeVisible();
  await expect(page.getByText('data.csv_edge_cases', {exact: true})).toHaveCount(0);
  expect(await engineCount()).toBe(1);
});
