import type {EditingSession} from '../../src/application/workspaceService';
export async function seedGolden(session: EditingSession, files: Record<string, string>) {
  const signal = new AbortController().signal;
  for (const name of ['gemeinden', 'bevoelkerung', 'fahrzeuge']) {
    const p = await session
      .getDatasets()
      .preview(new File([files[`${name}.csv`]!], `${name}.csv`), 'csv', undefined, signal);
    await session.getDatasets().confirm(p.key, {name, sqlName: name, keepOriginal: true}, signal);
  }
  const sql = session.createAnalysis('sql');
  session.updateAnalysis(sql, {
    name: 'Golden SQL',
    code: files['01-fahrzeuge-pro-1000.sql']!,
    parameters: {jahr: 2024},
  });
  const first = await session.getAnalyses().run(sql),
    source = session.document.runs[first]!.resultIds[0]!;
  const r = session.createAnalysis('r'),
    rs = session.getR();
  session.updateAnalysis(r, {name: 'Golden R'});
  const p = await rs.planToR(source, r, 'daten', signal);
  await rs.commitToR(
    p.id,
    p.issues.filter((i) => i.requiresApproval).map((i) => i.id),
    signal,
  );
  session.updateAnalysis(r, {code: files['02-vergleich.R']!});
  const run = await rs.run(r);
  if (session.document.runs[run]!.status !== 'succeeded')
    throw Error(JSON.stringify(session.document.runs[run]));
  const back = await rs.planFromR(
    rs.objectList.find((o) => o.ref.name === 'vergleich')!.ref,
    signal,
  );
  await rs.commitFromR(back.id, 'Vergleich', [], signal, {sqlName: 'vergleich'});
  session.updateAnalysis(r, {code: files['02b-plot.R']!});
  const pr = await rs.run(r),
    plot = session.document.runs[pr]!.resultIds[0]!;
  await rs.keepPlot(plot);
  const resultSql = session.createAnalysis('sql');
  session.updateAnalysis(resultSql, {name: 'Rück-SQL', code: files['03-klassifikation.sql']!});
  const returned = await session.getAnalyses().run(resultSql),
    result = session.document.runs[returned]!.resultIds[0]!;
  await session
    .getAnalyses()
    .saveVisualization(result, 'Klassifikation', {type: 'bar', x: 'klasse', y: 'anzahl'});
  await session.flush();
  return {document: session.document, result, plot};
}
