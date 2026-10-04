import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mirrorWebRPackages} from './mirrorWebRPackages.mjs';
const root = new URL('../public/vendor/webr-packages/', import.meta.url);
const expected = JSON.parse(
  await readFile(new URL('./webr-package-checksums.json', import.meta.url), 'utf8'),
);
let missing = false;
for (const path of Object.keys(expected))
  try {
    await readFile(new URL(path, root));
  } catch {
    missing = true;
    break;
  }
if (missing) await mirrorWebRPackages();
for (const [path, hash] of Object.entries(expected)) {
  const bytes = await readFile(new URL(path, root));
  if (createHash('sha256').update(bytes).digest('hex') !== hash)
    throw Error(`webR package checksum mismatch: ${path}`);
}
console.log('Pinned local R package mirror verified.');
