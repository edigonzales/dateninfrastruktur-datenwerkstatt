import {test, expect} from '../persistentBrowser';
test('P5 native webR vectors, NA/NaN, Date, attributes and captured conditions', async ({page}) => {
  page.on('console', (m) => console.log('browser:', m.text()));
  await page.goto('/tests/spike/index.html');
  const proof = await page.evaluate(async () => {
    let step = 'init';
    try {
      const path = '/tests/spike/probe.ts';
      const {initR} = (await import(path)) as typeof import('../spike/probe');
      const r = await initR();
      const url = '/vendor/webr/0.6.0/webr.js';
      const module = (await import(url)) as typeof import('webr');

      await r.evalRVoid('Sys.setenv(TZ="UTC"); Sys.setlocale("LC_TIME","C")');
      const env = await new r.REnvironment();
      const d = await new r.RDouble([null, NaN, Infinity, -Infinity, -2147483648]);
      step = 'bind double';
      await env.bind('x', d);
      const nativeMissing = await r.evalRRaw('is.na(x) & !is.nan(x)', 'boolean[]', {env});
      const mask = await new r.RLogical([true, false, false, false, false]);
      await env.bind('missing', mask);
      await r.evalRVoid('x[missing] <- NA', {env});
      const corrected = await r.evalR('x', {env});
      if (!module.isRDouble(corrected)) throw Error('Expected numeric vector');
      step = 'character';
      const ch = await new r.RCharacter(['001', '', 'NULL', null, 'ü']);
      await env.bind('kennung', ch);
      step = 'frame';
      const frame = await r.evalR(
        'structure(list(x=x,kennung=kennung),class="data.frame",row.names=.set_row_names(5L))',
        {env},
      );
      step = 'bind frame';
      await env.bind('df', frame);
      step = 'attribute';
      await r.evalRVoid('attr(df$x,"lab_schema") <- "DOUBLE"', {env});
      step = 'date';
      await r.evalRVoid('df$date <- structure(c(20541,NA,NA,NA,NA),class="Date")', {env});
      step = 'factor';
      await r.evalRVoid('df$f <- factor(c("b","a",NA,"b","a"),levels=c("a","b","unused"))', {env});
      step = 'array';
      const values = await corrected.toTypedArray();
      step = 'mask';
      const missing = await r.evalRRaw('is.na(x) & !is.nan(x)', 'boolean[]', {env});
      step = 'capture';
      const shelter = await new r.Shelter();
      const captured = await shelter.captureR(
        'cat("out\\n"); warning("warn"); message("msg"); df',
        {env, throwJsException: false, captureGraphics: false},
      );
      const outputs = [];
      for (const event of captured.output) {
        const data: unknown = event.data;
        let text = 'unknown';
        if (typeof data === 'string') text = data;
        else if (module.isRObject(data)) {
          await env.bind('condition', data);
          text = await r.evalRString('conditionMessage(condition)', {env});
        }
        outputs.push({type: event.type, text});
      }
      const encoded = Array.from(values, (v, i) => (missing[i] ? 'NA' : String(v)));
      step = 'class';
      const classes = await r.evalRRaw('class(df)', 'string[]', {env});
      await shelter.purge();
      await r.destroy(frame);
      await r.destroy(d);
      await r.destroy(mask);
      await r.destroy(corrected);
      await r.destroy(env);
      r.close();
      return {encoded, missing, outputs, classes, nativeMissing};
    } catch (e) {
      throw Error(step + ': ' + String(e) + ' ' + JSON.stringify(e, Object.getOwnPropertyNames(e)));
    }
  });
  console.log(JSON.stringify(proof));
  expect(proof.encoded).toEqual(['NA', 'NaN', 'Infinity', '-Infinity', '-2147483648']);
  expect(proof.missing).toEqual([true, false, false, false, false]);
  expect(proof.classes).toContain('data.frame');
});
