import {test as base} from '@playwright/test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolateOpfs} from './isolateOpfs';
/** OPFS persistence acceptance uses fresh normal profiles, not private contexts. */
export const test = base.extend({
  page: async ({context}, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
  context: async ({playwright, browserName}, use) => {
    const path = await mkdtemp(join(tmpdir(), 'datenwerkstatt-browser-'));
    const context = await playwright[browserName].launchPersistentContext(path, {
      headless: true,
      baseURL: 'http://127.0.0.1:4173',
      timezoneId: 'UTC',
    });
    const cleanup = await isolateOpfs(context);
    try {
      await use(context);
    } finally {
      try {
        await cleanup();
      } finally {
        await context.close();
        await rm(path, {recursive: true, force: true});
      }
    }
  },
});
export {expect} from '@playwright/test';
