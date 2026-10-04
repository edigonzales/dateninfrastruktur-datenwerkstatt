import {mkdir, cp, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const expected = JSON.parse(
  await readFile(new URL('./extension-checksums.json', import.meta.url), 'utf8'),
);
const vendor = new URL('../public/vendor/', import.meta.url);
await mkdir(vendor, {recursive: true});
await cp(new URL('../node_modules/webr/dist/', import.meta.url), new URL('webr/0.6.0/', vendor), {
  recursive: true,
  filter: (path) => !path.endsWith('.map'),
});
await cp(
  new URL('../node_modules/@duckdb/duckdb-wasm/dist/', import.meta.url),
  new URL('duckdb/1.33.1-dev57.0/', vendor),
  {recursive: true, filter: (path) => !path.endsWith('.map')},
);
const extensions = ['parquet', 'httpfs', 'json', 'icu'];
const checksums = {};
for (const platform of ['wasm_mvp', 'wasm_eh'])
  for (const name of extensions) {
    const relative = `duckdb-extensions/v1.5.4/${platform}/${name}.duckdb_extension.wasm`;
    const dest = new URL(relative, vendor);
    let bytes;
    try {
      bytes = await readFile(dest);
    } catch {
      const response = await fetch(
        `https://extensions.duckdb.org/v1.5.4/${platform}/${name}.duckdb_extension.wasm`,
      );
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(new URL('./', dest), {recursive: true});
      await writeFile(dest, bytes);
    }
    checksums[relative] = createHash('sha256').update(bytes).digest('hex');
    if (checksums[relative] !== expected[relative])
      throw new Error(`Asset checksum mismatch: ${relative}`);
  }
await writeFile(new URL('asset-checksums.json', vendor), JSON.stringify(checksums, null, 2) + '\n');
console.log(`Local webR 0.6.0 and ${extensions.length} DuckDB extensions prepared.`);
await import('./prepare-r-packages.mjs');
