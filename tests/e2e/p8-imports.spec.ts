import {test, expect} from '../persistentBrowser';
import {rawZip} from '../archive/rawZip';
import {mkdtemp, writeFile, truncate, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('P8 AT-019 AT-020: XLSX invalidates old preview, real over-limit file and visible replacement schema', async ({
  page,
}) => {
  const folder = await mkdtemp(join(tmpdir(), 'dw-import-limit-'));
  const tooLarge = join(folder, 'over-128-mib.csv');
  await writeFile(tooLarge, 'wert\n1\n');
  await truncate(tooLarge, 134217729); // Real sparse file, exactly one byte above the unchanged default.
  const xml = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Test" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>42</v></c></row></sheetData></worksheet>',
  };
  const xlsx = rawZip(
    Object.entries(xml).map(([name, data]) => ({name, data: new TextEncoder().encode(data)})),
  );
  try {
    await page.goto('/workspaces');
    await page.getByLabel('Name des neuen Arbeitsbereichs').fill('Importgrenzen');
    await page.getByRole('button', {name: 'Neuer Arbeitsbereich', exact: true}).click();
    await page.getByRole('button', {name: 'Datei hinzufügen', exact: true}).click();
    const input = page.getByLabel('Datei (CSV oder Parquet, maximal 128 MiB)');
    const csv = {name: 'daten.csv', mimeType: 'text/csv', buffer: Buffer.from('wert\n1\n')};
    await input.setInputFiles(csv);
    await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Import bestätigen', exact: true})).toBeEnabled();
    await input.setInputFiles({
      name: 'tabelle.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(await xlsx.arrayBuffer()),
    });
    await expect(page.getByRole('alert')).toContainText('Unterstützt sind CSV und Parquet');
    await expect(page.getByRole('button', {name: 'Import bestätigen', exact: true})).toBeDisabled();
    await expect(page.getByRole('button', {name: 'Vorschau laden', exact: true})).toBeDisabled();
    await input.setInputFiles(tooLarge);
    await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
    await expect(page.getByRole('alert')).toContainText('134217728');
    await expect(page.getByRole('button', {name: 'Import bestätigen', exact: true})).toBeDisabled();
    await input.setInputFiles(csv);
    await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
    await page.getByRole('button', {name: 'Import bestätigen', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', {name: 'Daten ersetzen', exact: true}).click();
    await input.setInputFiles({
      name: 'zweite.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('wert;neu\n2;Text\n'),
    });
    await page.getByRole('button', {name: 'Vorschau laden', exact: true}).click();
    await expect(page.getByRole('dialog')).toContainText('Schemaänderung:');
    await expect(page.getByRole('dialog')).toContainText('neu');
    await expect(page.getByLabel('SQL-Name', {exact: true})).toBeDisabled();
    await page.getByRole('button', {name: 'Import bestätigen', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('data.daten', {exact: true})).toHaveCount(1);
    await page.getByRole('button', {name: 'Daten ansehen', exact: true}).click();
    await expect(page.getByRole('cell', {name: 'Text', exact: true})).toBeVisible();
  } finally {
    await rm(folder, {recursive: true, force: true});
  }
});
