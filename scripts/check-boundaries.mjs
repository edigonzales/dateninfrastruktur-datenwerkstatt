import ts from 'typescript';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
const violations = [];
async function check(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await check(path);
      continue;
    }
    if (!/\.tsx?$/.test(path)) continue;
    const source = ts.createSourceFile(
      path,
      await readFile(path, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const from =
          node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
            ? node.moduleSpecifier.text
            : '';
        if (path.startsWith('src/domain/') && from && from !== 'zod' && !from.startsWith('.'))
          violations.push(`${path}: domain import ${from}`);
        if (
          path.startsWith('src/domain/') &&
          /application|infrastructure|features|state|app\//.test(from)
        )
          violations.push(`${path}: domain boundary ${from}`);
        if (
          path.startsWith('src/application/') &&
          /infrastructure|features|react|sqlrooms|duckdb|webr|dexie/.test(from)
        )
          violations.push(`${path}: application boundary ${from}`);
      }
      if (
        (path.startsWith('src/domain/') || path.startsWith('src/features/')) &&
        ts.isIdentifier(node) &&
        !(
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node &&
          node.parent.expression.getText(source) !== 'globalThis'
        ) &&
        ['indexedDB', 'navigator', 'Worker', 'document', 'window'].includes(node.text)
      )
        violations.push(`${path}: browser API ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
await check('src');
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log('Module boundaries checked.');
