import {test, expect} from '../persistentBrowser';
import config from '../../public/runtime-config.json' with {type: 'json'};
test('P5 pinned local R packages installed and used', async ({page}) => {
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(async (config) => {
    const path = '/src/infrastructure/webr/engine.ts';
    const {WebREngine} = (await import(
      path
    )) as typeof import('../../src/infrastructure/webr/engine');
    const r = new WebREngine(
      crypto.randomUUID(),
      config as unknown as import('../../contracts/runtime-config').RuntimeConfig,
    );
    try {
      await r.initialize(new AbortController().signal);
      const scope = await r.createScope('workspace-session');
      const runtime = await r.fingerprint();
      const outputs: string[] = [];
      await r.evaluate(
        scope,
        crypto.randomUUID() as import('../../src/domain/model').RunId,
        {
          language: 'r',
          code: 'library(ggplot2); library(dplyr); library(tidyr); library(readr); cat(as.character(packageVersion("ggplot2")))',
          parameters: {},
          resolvedInputs: [],
          inputScope: 'explicit-bindings',
          runtime,
          provenance: 'session-dependent',
          notes: [],
        },
        (event) => {
          if (event.kind === 'plot') event.image.close();
          else outputs.push(event.text);
        },
        new AbortController().signal,
      );
      return {runtime: await r.fingerprint(), outputs};
    } catch (e) {
      throw Error(
        'R package init: ' + String(e) + ' ' + JSON.stringify(e, Object.getOwnPropertyNames(e)),
      );
    } finally {
      await r.dispose();
    }
  }, config);
  expect(result.runtime.rPackageVersions?.ggplot2).toBe('4.0.3');
  expect(result.outputs.join('')).toContain('4.0.3');
});
