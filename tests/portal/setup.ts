import type {Page, APIRequestContext} from '@playwright/test';
import config from '../../public/runtime-config.json' with {type: 'json'};
export const portalConfig = {
  ...config,
  portalProviders: [
    {
      id: 'fixture',
      title: 'Synthetisches Testportal',
      baseUrl: 'http://127.0.0.1:4174/portal/',
      indexUrl: 'http://127.0.0.1:4174/portal/index.json',
    },
    {id: 'direct', title: 'Ohne Index', baseUrl: 'http://127.0.0.1:4174/portal/'},
  ],
  allowedDataOrigins: ['http://127.0.0.1:4174'],
};
export async function setupPortal(page: Page, request: APIRequestContext) {
  await request.post('http://127.0.0.1:4174/__reset');
  await page.goto('/tests/spike/index.html');
  await page.evaluate(async () => {
    const path = '/src/infrastructure/sqlrooms/fileImportEngine.ts';
    const {DuckDbFileImportEngine} = (await import(
      path
    )) as typeof import('../../src/infrastructure/sqlrooms/fileImportEngine');
    const engine = new DuckDbFileImportEngine(134217728);
    const signal = new AbortController().signal;
    try {
      const preview = await engine.preview(
        new File(['gemeinde_id;wert\n001;10\n002;20\n'], 'portal.csv'),
        'csv',
        undefined,
        signal,
      );
      const prepared = await engine.prepare(preview.key, signal);
      await fetch('http://127.0.0.1:4174/__file', {
        method: 'POST',
        body: await new Response(prepared.data).arrayBuffer(),
      });
    } finally {
      await engine.dispose();
    }
  });
}
