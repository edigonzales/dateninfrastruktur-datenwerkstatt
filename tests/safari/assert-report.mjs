import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const [pilotPath, restartPath] = process.argv.slice(2);
assert(pilotPath, 'Usage: node tests/safari/assert-report.mjs PILOT.json [RESTART.json]');
const pilot = JSON.parse(await readFile(pilotPath, 'utf8'));
assert.equal(pilot.status, 'passed');
assert.match(pilot.userAgent, /Version\/27\.0\.1 Safari\//);
assert(!pilot.error);
const check = (name) => {
  const matches = pilot.checks.filter((c) => c.name === name);
  assert.equal(matches.length, 1, `Missing/duplicate check: ${name}`);
  return matches[0].evidence;
};
const storage = check('native-browser-and-persistent-storage');
assert.equal(storage.origin, 'http://127.0.0.1:4184');
assert(storage.opfs && storage.locks);
const workspace = check('created-test-workspace').workspaceId;
const sql = check('mixed-local-public-golden-sql');
assert.equal(sql.rows.length, 4);
assert.equal(sql.rows[0][0], '002');
assert.equal(sql.rows[3][5], null);
assert.equal(sql.publicVersion.backing.kind, 'public-parquet');
const returned = [
  ['hoch', '2'],
  ['nicht berechenbar', '1'],
  ['niedrig', '1'],
];
const r = check('golden-r-and-return-sql');
assert.equal(r.completeTransfer, '4');
assert.deepEqual(r.returned, returned);
const archive = check('png-archive-and-persistence');
assert(archive.pngBytes > 1000 && archive.archiveBytes > 1000);
assert.equal(archive.runtime.engineVersion, 'webR 0.6.0');
assert(check('native-worker-release-at-close').workers.every((w) => w.terminated));
const reopened = check('native-tab-reopen-and-archive');
assert.equal(reopened.original, workspace);
assert.notEqual(reopened.imported, workspace);
assert.equal(reopened.nativeWorkerAutostart, false);
assert.deepEqual(reopened.rows, returned);
const cancelled = check('native-postmessage-cancel-and-new-r');
assert(cancelled.cancelMs < 10000);
assert(cancelled.epochAfter > cancelled.epochBefore);
assert(cancelled.followup.some((line) => line.text === '42'));
assert(check('safari-engine-pilot-passed').workers.every((w) => w.terminated));
if (restartPath) {
  const restart = JSON.parse(await readFile(restartPath, 'utf8'));
  assert.equal(restart.status, 'passed');
  assert.equal(restart.userAgent, pilot.userAgent);
  assert(!restart.error);
  const evidence = restart.checks.find(
    (c) => c.name === 'persisted-state-after-operator-confirmed-restart',
  )?.evidence;
  assert(evidence, 'Restart persistence check missing');
  assert.equal(evidence.sourcePilotId, pilot.id);
  assert.equal(evidence.workspaceId, workspace);
  assert.deepEqual(evidence.rows, returned);
  assert.equal(evidence.pngBytes, archive.pngBytes);
  assert.equal(evidence.runs, archive.runCount);
  assert(evidence.workers.every((w) => w.terminated));
}
console.log(
  JSON.stringify(
    {
      status: 'passed',
      pilot: pilotPath,
      restart: restartPath ?? 'not checked',
      note: 'Validates browser receipts. Actual app restart and native UI observations require a separate operator record.',
    },
    null,
    2,
  ),
);
