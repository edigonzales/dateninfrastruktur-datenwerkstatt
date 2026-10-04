import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Capture the working candidate as a Git tree without changing the user's index/branch.
const directory = await mkdtemp(join(tmpdir(), 'datenwerkstatt-clean-'));
const phase = process.argv[2] ?? 'p7';
if (!/^p[0-8]$/.test(phase)) throw Error('Expected phase p0 through p8');
const index = join(directory, 'candidate-index');
const env = {...process.env, GIT_INDEX_FILE: index};
const run = (args, options = {}) => execFileSync('git', args, {env, ...options});
run(['read-tree', '--empty']);
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .toString()
  .split('\0')
  .filter((p) => p && !p.startsWith('docs/verification/'));
await writeFile(join(directory, 'paths'), paths.join('\0') + '\0');
run(['add', '--pathspec-from-file=' + join(directory, 'paths'), '--pathspec-file-nul']);
const tree = run(['write-tree']).toString().trim();
run(['archive', '--format=tar', '--output=' + join(directory, 'source.tar'), tree]);
const checkout = join(directory, 'source');
await mkdir(checkout);
execFileSync('tar', ['-xf', join(directory, 'source.tar'), '-C', checkout]);
await mkdir(join(checkout, 'docs/verification'), {recursive: true});
await rm(index, {force: true});
const result = {
  tree,
  gitBase: run(['rev-parse', 'HEAD']).toString().trim(),
  checkout,
  note: 'Fresh Git-tree export of the uncommitted candidate; actual branch/index unchanged. No dependencies/assets/results copied.',
};
await writeFile(`docs/verification/clean-source-${phase}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
