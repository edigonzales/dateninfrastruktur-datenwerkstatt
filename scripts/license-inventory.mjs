import {readFile, readdir, mkdir, writeFile, copyFile, cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root = 'dist/licenses';
await mkdir(root, {recursive: true});
await cp('licenses', `${root}/original-notices`, {recursive: true});
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const npm = [];
for (const [path, record] of Object.entries(lock.packages)) {
  if (!path) continue;
  let data;
  try {
    data = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
  } catch (error) {
    if (record.optional && error.code === 'ENOENT') {
      npm.push({
        name: path.split('node_modules/').at(-1),
        version: record.version,
        license: record.license ?? 'not-declared',
        installed: false,
        optional: true,
      });
      continue;
    }
    throw error;
  }
  const texts = [];
  for (const entry of await readdir(path, {withFileTypes: true})) {
    if (!entry.isFile() || !/^(licen[sc]e|copying|notice)([._-]|$)/i.test(entry.name)) continue;
    const directory = `npm/${data.name.replaceAll('/', '__')}/${data.version}`;
    await mkdir(`${root}/${directory}`, {recursive: true});
    await copyFile(`${path}/${entry.name}`, `${root}/${directory}/${entry.name}`);
    texts.push(`${directory}/${entry.name}`);
  }
  npm.push({
    name: data.name,
    version: data.version,
    dev: !!record.dev,
    license: data.license ?? record.license ?? 'not-declared',
    repository: data.repository ?? null,
    integrity: record.integrity,
    texts,
  });
}
await writeFile(`${root}/npm-inventory.json`, JSON.stringify(npm, null, 2));
const rlock = JSON.parse(await readFile('scripts/webr-packages.lock.json', 'utf8'));
const hashes = JSON.parse(await readFile('scripts/webr-package-checksums.json', 'utf8'));
const packages = [];
for (const pkg of rlock.packages) {
  const archive = Object.keys(hashes).find((path) =>
    path.endsWith(`/${pkg.name}_${pkg.version}.tgz`),
  );
  if (!archive) throw Error(`Missing pinned package ${pkg.name}`);
  const path = `public/vendor/webr-packages/${archive}`;
  const names = execFileSync('tar', ['-tzf', path], {encoding: 'utf8'}).trim().split('\n');
  const included = names.filter((name) =>
    /(^|\/)(DESCRIPTION|LICENSE(?:[.][^/]*)?|LICENCE(?:[.][^/]*)?|COPYING(?:[.][^/]*)?|NOTICE(?:[.][^/]*)?)$/i.test(
      name,
    ),
  );
  const texts = [];
  let license = 'not-declared';
  for (const name of included) {
    if (name.split('/').includes('..') || name.startsWith('/'))
      throw Error('Unsafe package license path');
    const text = execFileSync('tar', ['-xOzf', path, name], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const target = `r/${pkg.name}/${name.replaceAll('/', '__')}`;
    await mkdir(`${root}/r/${pkg.name}`, {recursive: true});
    await writeFile(`${root}/${target}`, text);
    texts.push(target);
    if (name === `${pkg.name}/DESCRIPTION`)
      license = text.match(/^License: (.*(?:\n[ \t].*)*)/m)?.[1].replace(/\n\s*/g, ' ') ?? license;
  }
  packages.push({...pkg, license, archive, sha256: hashes[archive], texts});
}
await writeFile(`${root}/r-inventory.json`, JSON.stringify(packages, null, 2));
const native = {
  duckdb: {
    version: '1.33.1-dev57.0',
    engine: '1.5.4',
    license: 'MIT',
    source: 'https://github.com/duckdb/duckdb-wasm',
  },
  webr: {
    version: '0.6.0',
    binaryLicense: 'GPL-3.0',
    notes:
      'original-notices/webr-0.6.0.md; embedded base R packages also retain DESCRIPTION/licenses in vendor/webr/0.6.0/vfs/',
    source: 'https://github.com/r-wasm/webr/tree/v0.6.0',
  },
  extensions: JSON.parse(await readFile('scripts/extension-checksums.json', 'utf8')),
  container: {
    caddy: '2.11.4',
    license: 'Apache-2.0',
    digest: 'sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648',
  },
};
await writeFile(`${root}/native-inventory.json`, JSON.stringify(native, null, 2));
console.log(
  `License inventory: ${npm.length} npm entries, ${packages.length} pinned R packages; original notices copied.`,
);
