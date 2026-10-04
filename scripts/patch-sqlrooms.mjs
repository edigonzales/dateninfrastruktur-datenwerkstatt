import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
// SQLRooms 0.28.0 only; see ADR-007. Fail closed if the upstream file changes.
const path = new URL(
  '../node_modules/@sqlrooms/duckdb/dist/connectors/WasmDuckDbConnector.js',
  import.meta.url,
);
const source = await readFile(path, 'utf8');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const original = 'b0599784fe1ef25d7649f5cd3fb610a76218ad4aab756dfe3b1ee2e27b3186b7';
const marker = '// Datenwerkstatt: release failed initialization resources (ADR-007).';
function patch(text) {
  return text
    .replace(
      '    let worker = null;',
      `    let worker = null;\n    let workerUrl = null;\n    ${marker}`,
    )
    .replace(
      '                const workerUrl = URL.createObjectURL',
      '                workerUrl = URL.createObjectURL',
    )
    .replace(
      '                    onError(event) {',
      `                    async terminate() {\n                        if (workerUrl) URL.revokeObjectURL(workerUrl);\n                        workerUrl = null;\n                        await super.terminate();\n                    }\n                    onError(event) {`,
    )
    .replace(
      '                URL.revokeObjectURL(workerUrl);',
      '                URL.revokeObjectURL(workerUrl);\n                workerUrl = null;',
    )
    .replace(
      '            catch (err) {\n                db = null;',
      `            catch (err) {\n                worker?.terminate();\n                if (workerUrl) URL.revokeObjectURL(workerUrl);\n                workerUrl = null;\n                db = null;`,
    );
}
const expected = '4b42205df547f9db7c6210c566e64eae8585d50e9725bc6bc0457908bff3019f';
if (digest(source) === original) {
  const changed = patch(source);
  if (digest(changed) !== expected)
    throw Error('SQLRooms patch implementation changed; review required');
  await writeFile(path, changed);
  console.log('Applied SQLRooms 0.28.0 initialization cleanup (ADR-007).');
} else if (digest(source) !== expected) {
  throw Error('Unexpected SQLRooms connector; review ADR-007 patch before building');
} else console.log('SQLRooms initialization cleanup verified.');
