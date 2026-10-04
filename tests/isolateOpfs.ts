import type {BrowserContext} from '@playwright/test';
/** Real OPFS, scoped below a test-owned UUID directory. macOS WebKit can share its
 * native OPFS across persistent profiles even when IndexedDB is profile-local. */
export async function isolateOpfs(
  context: BrowserContext,
  key = crypto.randomUUID(),
  cleanupUrl = 'http://127.0.0.1:4173/tests/spike/index.html',
) {
  const directoryName = `datenwerkstatt-test-${key}`;
  await context.addInitScript((name) => {
    const prototype = Object.getPrototypeOf(navigator.storage) as StorageManager;
    const original = prototype.getDirectory;
    if (typeof original !== 'function') return;
    Object.defineProperty(prototype, 'getDirectory', {
      configurable: true,
      writable: true,
      value: async function (this: StorageManager) {
        return (await original.call(this)).getDirectoryHandle(name, {create: true});
      },
    });
    Reflect.set(globalThis, '__datenwerkstattTestCleanup', async () => {
      try {
        await (await original.call(navigator.storage)).removeEntry(name, {recursive: true});
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
    });
  }, directoryName);
  return async () => {
    // Close only this test's pages first, releasing their workers/native handles.
    for (const page of context.pages()) await page.close();
    const cleanup = await context.newPage();
    try {
      // Production URLs would boot the app and create a capability-probe file
      // while removing this same test directory. Use an inert same-origin page.
      await cleanup.route('**/*', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Test cleanup</title>',
        }),
      );
      await cleanup.goto(cleanupUrl);
      await cleanup.evaluate(async () => {
        const cleanup: unknown = Reflect.get(globalThis, '__datenwerkstattTestCleanup');
        if (typeof cleanup === 'function') await cleanup();
      });
    } finally {
      await cleanup.close();
    }
  };
}
