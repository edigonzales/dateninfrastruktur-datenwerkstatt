import {test, expect} from '../persistentBrowser';
import {isolateOpfs} from '../isolateOpfs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('P6 test storage: fresh native OPFS scopes are disjoint across profiles and survive reload', async ({
  page,
  playwright,
  browserName,
}) => {
  await page.goto('/tests/spike/index.html');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await root.getFileHandle('only-a', {create: true}),
      writer = await file.createWritable();
    await writer.write('A');
    await writer.close();
  });
  const profile = await mkdtemp(join(tmpdir(), 'dw-isolation-proof-'));
  const second = await playwright[browserName].launchPersistentContext(profile, {headless: true});
  const cleanup = await isolateOpfs(second);
  try {
    const next = second.pages()[0] ?? (await second.newPage());
    await next.goto('http://127.0.0.1:4173/tests/spike/index.html');
    const entries = await next.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const file of (
        root as FileSystemDirectoryHandle & {values(): AsyncIterable<FileSystemHandle>}
      ).values())
        names.push(file.name);
      const file = await root.getFileHandle('only-b', {create: true}),
        writer = await file.createWritable();
      await writer.write('B');
      await writer.close();
      return names;
    });
    expect(entries).toEqual([]);
    await page.reload();
    const first = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      let missing = false;
      try {
        await root.getFileHandle('only-b');
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotFoundError') missing = true;
        else throw e;
      }
      return {text: await (await (await root.getFileHandle('only-a')).getFile()).text(), missing};
    });
    expect(first).toEqual({text: 'A', missing: true});
  } finally {
    try {
      await cleanup();
    } finally {
      await second.close();
      await rm(profile, {recursive: true, force: true});
    }
  }
});
