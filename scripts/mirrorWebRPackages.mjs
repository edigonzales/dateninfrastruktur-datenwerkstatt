import {existsSync} from 'node:fs';
import {readFile, mkdir, rm, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const moduleFile = import.meta.url.startsWith('file:')
  ? fileURLToPath(import.meta.url)
  : join(process.cwd(), 'scripts/mirrorWebRPackages.mjs');
const rootDir = dirname(dirname(moduleFile));
const projectDir = rootDir;
const defaultLockPath = join(rootDir, 'scripts/webr-packages.lock.json');
const outputRoot = join(projectDir, 'public/vendor/webr-packages');
const basePackages = new Set([
  'R',
  'base',
  'compiler',
  'datasets',
  'grDevices',
  'graphics',
  'grid',
  'methods',
  'parallel',
  'splines',
  'stats',
  'stats4',
  'tcltk',
  'tools',
  'utils',
  'webr'
]);

if (isMainModule()) {
  await mirrorWebRPackages();
}

export async function mirrorWebRPackages({lockPath = defaultLockPath, targetRoot = outputRoot} = {}) {
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const repoBaseUrl = trimTrailingSlash(lock.repoBaseUrl);
  const targetPath = lock.targetPath ?? 'bin/emscripten/contrib/4.6';
  const packageDir = join(targetRoot, targetPath);
  const indexText = await fetchText(`${repoBaseUrl}/PACKAGES`);
  const packageRecords = parsePackageIndex(indexText);
  const selectedRecords = selectLockedRecords(packageRecords, lock);

  await rm(targetRoot, {force: true, recursive: true});
  await mkdir(packageDir, {recursive: true});
  const filteredIndex = formatPackageIndex(selectedRecords);
  await writeFile(join(packageDir, 'PACKAGES'), filteredIndex, 'utf8');
  const compressedIndex = gzipSync(filteredIndex);
  // RFC 1952 OS=255: the generated index must be identical on macOS and Linux.
  compressedIndex[9] = 255;
  await writeFile(join(packageDir, 'PACKAGES.gz'), compressedIndex);
  await downloadPackage(`${repoBaseUrl}/PACKAGES.rds`, join(packageDir, 'PACKAGES.rds'));
  await writeFile(
    join(targetRoot, 'lock.json'),
    JSON.stringify({
      repoBaseUrl,
      targetPath,
      rootPackages: lock.rootPackages,
      packages: selectedRecords.map((record) => ({name: record.Package, version: record.Version}))
    }, null, 2),
    'utf8'
  );

  for (const record of selectedRecords) {
    const filename = packageArchiveName(record);
    await downloadPackage(`${repoBaseUrl}/${filename}`, join(packageDir, filename));
  }

  console.log(`Mirrored ${selectedRecords.length} WebR packages to ${relative(projectDir, packageDir)}.`);
  return selectedRecords;
}

export function parsePackageIndex(text) {
  const records = [];
  let record = null;
  let currentKey = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (record) {
        records.push(record);
      }
      record = null;
      currentKey = null;
      continue;
    }

    if (/^\s/.test(line) && record && currentKey) {
      record[currentKey] = `${record[currentKey]} ${line.trim()}`;
      continue;
    }

    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    record ??= {__fieldOrder: []};
    currentKey = match[1];
    record[currentKey] = match[2];
    record.__fieldOrder.push(currentKey);
  }

  if (record) {
    records.push(record);
  }
  return records;
}

export function dependencyNames(record) {
  return ['Depends', 'Imports', 'LinkingTo']
    .flatMap((fieldName) => (record[fieldName] ?? '').split(','))
    .map((dependency) => dependency.trim().replace(/\s*\(.+\)$/, ''))
    .filter((dependency) => dependency.length > 0 && !basePackages.has(dependency));
}

export function resolvePackageClosure(packageRecords, rootPackages) {
  const byName = new Map(packageRecords.map((record) => [record.Package, record]));
  const selected = new Set();
  const stack = [...rootPackages];

  while (stack.length > 0) {
    const packageName = stack.pop();
    if (!packageName || selected.has(packageName) || basePackages.has(packageName)) {
      continue;
    }
    const record = byName.get(packageName);
    if (!record) {
      throw new Error(`WebR package ${packageName} is not available in the source index.`);
    }
    selected.add(packageName);
    for (const dependency of dependencyNames(record)) {
      stack.push(dependency);
    }
  }

  return [...selected].sort();
}

export function selectLockedRecords(packageRecords, lock) {
  const byName = new Map(packageRecords.map((record) => [record.Package, record]));
  const lockedPackages = lock.packages?.length
    ? lock.packages.map((entry) => entry.name)
    : resolvePackageClosure(packageRecords, lock.rootPackages ?? []);
  const lockedVersions = new Map((lock.packages ?? []).map((entry) => [entry.name, entry.version]));
  const records = lockedPackages.map((packageName) => {
    const record = byName.get(packageName);
    if (!record) {
      throw new Error(`Locked WebR package ${packageName} is missing from ${lock.repoBaseUrl}.`);
    }
    const expectedVersion = lockedVersions.get(packageName);
    if (expectedVersion && record.Version !== expectedVersion) {
      throw new Error(`Locked WebR package ${packageName} expected ${expectedVersion}, found ${record.Version}.`);
    }
    return record;
  });

  const resolved = new Set(resolvePackageClosure(packageRecords, lock.rootPackages ?? []));
  const locked = new Set(lockedPackages);
  for (const dependency of resolved) {
    if (!locked.has(dependency)) {
      throw new Error(`Lock file is missing resolved WebR dependency ${dependency}.`);
    }
  }

  return records.sort((left, right) => left.Package.localeCompare(right.Package));
}

export function formatPackageIndex(records) {
  return `${records.map((record) => {
    const keys = record.__fieldOrder?.length ? record.__fieldOrder : Object.keys(record).filter((key) => !key.startsWith('__'));
    return keys
      .filter((key) => !key.startsWith('__') && record[key] !== undefined)
      .map((key) => `${key}: ${record[key]}`)
      .join('\n');
  }).join('\n\n')}\n`;
}

function packageArchiveName(record) {
  return `${record.Package}_${record.Version}.tgz`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function downloadPackage(url, target) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
  }
  await mkdir(dirname(target), {recursive: true});
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(target, bytes);
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function isMainModule() {
  return process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}
