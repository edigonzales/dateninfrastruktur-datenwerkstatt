import {test, expect} from '../persistentBrowser';
import {readFile} from 'node:fs/promises';
import config from '../../public/runtime-config.json' with {type: 'json'};
test('P5 AT-041 AT-048: unchanged Golden SQL → R script → explicit capture → Golden SQL, real plot and reopen', async ({
  page,
}) => {
  const names = [
    '01-fahrzeuge-pro-1000.sql',
    '02-vergleich.R',
    '02b-plot.R',
    '03-klassifikation.sql',
    'gemeinden.csv',
    'bevoelkerung.csv',
    'fahrzeuge.csv',
    'golden/r-vergleich.json',
    'golden/rueck-sql.json',
  ];
  const files = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(`fixtures/${name}`, 'utf8')]),
    ),
  );
  await page.goto('/tests/spike/index.html');
  const result = await page.evaluate(
    async ({config, files}) => {
      const hp = '/tests/spike/sqlHarness.ts';
      const {sqlHarness} = (await import(hp)) as typeof import('../spike/sqlHarness');
      const {service, session} = await sqlHarness(
          30000,
          undefined,
          config as unknown as import('../../contracts/runtime-config').RuntimeConfig,
        ),
        signal = new AbortController().signal;
      try {
        for (const name of ['gemeinden', 'bevoelkerung', 'fahrzeuge']) {
          const preview = await session
            .getDatasets()
            .preview(new File([files[`${name}.csv`]!], `${name}.csv`), 'csv', undefined, signal);
          await session
            .getDatasets()
            .confirm(preview.key, {name, sqlName: name, keepOriginal: false}, signal);
        }
        const sql = session.createAnalysis('sql');
        session.updateAnalysis(sql, {
          code: files['01-fahrzeuge-pro-1000.sql']!,
          parameters: {jahr: 2024},
        });
        const run = await session.getAnalyses().run(sql),
          resultId = session.document.runs[run]!.resultIds[0]!;
        const r = session.createAnalysis('r'),
          rs = session.getR();
        const transfer = await rs.planToR(resultId, r, 'daten', signal);
        await rs.commitToR(
          transfer.id,
          transfer.issues.map((i) => i.id),
          signal,
        );
        session.updateAnalysis(r, {code: files['02-vergleich.R']!});
        const rRun = await rs.run(r);
        if (session.document.runs[rRun]!.status !== 'succeeded')
          throw Error(JSON.stringify(session.document.runs[rRun]!.error));
        const ref = rs.objectList.find((o) => o.ref.name === 'vergleich')!.ref;
        const preview = await rs.previewObject(ref, signal);
        const plan = await rs.planFromR(ref, signal);
        await rs.commitFromR(plan.id, 'vergleich', [], signal, {sqlName: 'vergleich'});
        session.updateAnalysis(sql, {code: files['03-klassifikation.sql']!, parameters: {}});
        const back = await session.getAnalyses().run(sql),
          backId = session.document.runs[back]!.resultIds[0]!;
        if (!backId) throw Error(JSON.stringify(session.document.runs[back]));
        const output = await session
          .getAnalyses()
          .page(backId, {offset: 0, size: 100, sort: []}, signal);
        await session.getAnalyses().keep(backId);
        session.updateAnalysis(r, {
          code: files['02b-plot.R']! + '\ncat("stdout\\n"); message("message"); warning("warning")',
        });
        const plotRun = await rs.run(r);
        const plotId = session.document.runs[plotRun]!.resultIds[0]!;
        const blob = await rs.plot(plotId, signal);
        await rs.keepPlot(plotId);
        const bitmap = await createImageBitmap(blob),
          canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
          ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const ink = ctx
          .getImageData(0, 0, canvas.width, canvas.height)
          .data.filter((v, i) => i % 4 !== 3 && v < 180).length;
        bitmap.close();
        const logs = rs.console(plotRun);
        const workspace = session.document.workspace.id;
        await service.close();
        const fresh = await service.open(workspace);
        const after = await fresh
          .getAnalyses()
          .page(backId, {offset: 0, size: 100, sort: []}, signal);
        const plot = await fresh.getR().plot(plotId, signal);
        return {
          preview,
          output,
          after,
          ink,
          plotBytes: plot.size,
          logs,
          capture: Object.values(fresh.document.runs).filter(
            (r) => r.trigger === 'r-object-capture',
          ),
          rCode: fresh.document.analyses[r]!.code,
        };
      } finally {
        await service.close();
      }
    },
    {config, files},
  );
  const expected = JSON.parse(files['golden/r-vergleich.json']!) as {
    rows: Record<string, unknown>[];
  };
  expect(result.preview.rows).toEqual(
    expected.rows.map((row) =>
      result.preview.schema.columns.map((c) => (row[c.name] === null ? null : String(row[c.name]))),
    ),
  );
  const back = JSON.parse(files['golden/rueck-sql.json']!) as {
    rows: {klasse: string; anzahl: string}[];
  };
  expect(result.output.rows).toEqual(back.rows.map((r) => [r.klasse, r.anzahl]));
  expect(result.after).toEqual(result.output);
  expect(result.ink).toBeGreaterThan(10000);
  expect(result.plotBytes).toBeGreaterThan(1000);
  expect(result.logs.map((l) => l.kind)).toEqual(
    expect.arrayContaining(['stdout', 'message', 'warning']),
  );
  expect(result.capture).toHaveLength(1);
  expect(result.capture[0]?.snapshot.inputScope).toBe('session-capture');
});
