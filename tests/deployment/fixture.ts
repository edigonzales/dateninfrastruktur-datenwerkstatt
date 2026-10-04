import {test as base, expect} from '@playwright/test';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {isolateOpfs} from '../isolateOpfs';
export const test = base.extend({
  page: async ({context}, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
  context: async ({playwright, browserName, baseURL}, use) => {
    if (!baseURL) throw Error('Deployment baseURL fehlt.');
    const directory = await mkdtemp(join(tmpdir(), 'datenwerkstatt-deploy-'));
    const context = await playwright[browserName].launchPersistentContext(directory, {
      headless: true,
      baseURL,
      timezoneId: 'UTC',
    });
    const cleanup = await isolateOpfs(context, crypto.randomUUID(), baseURL);
    try {
      await use(context);
    } finally {
      try {
        await cleanup();
      } finally {
        await context.close();
        await rm(directory, {recursive: true, force: true});
      }
    }
  },
});
export {expect};
