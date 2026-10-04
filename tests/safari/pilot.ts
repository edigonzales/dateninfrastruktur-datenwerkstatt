import {parseWorkspace, checkedId} from '../../src/domain/workspace';
import type {WorkspaceDocument} from '../../src/domain/model';
import {PortalAccess} from '../../src/infrastructure/catalog/portal';
import {DuckDbFileImportEngine} from '../../src/infrastructure/sqlrooms/fileImportEngine';
import {initializeServices, services} from '../../src/app/services';

type Check = {name: string; at: string; evidence: unknown};
type Report = {
  id: string;
  userAgent: string;
  startedAt: string;
  status: string;
  checks: Check[];
  error?: string;
};
const key = 'datenwerkstatt-safari-pilot';
const status = document.querySelector<HTMLPreElement>('#status')!;
const links = document.querySelector<HTMLDivElement>('#links')!;
let report: Report = {
  id: crypto.randomUUID(),
  userAgent: navigator.userAgent,
  startedAt: new Date().toISOString(),
  status: 'not-started',
  checks: [],
};
// Calls the actual native Worker. The report distinguishes terminate() calls from
// Playwright's native close-event evidence, which WebDriver does not expose.
const workers: {url: string; terminated: boolean}[] = [];
const NativeWorker = globalThis.Worker;
globalThis.Worker = class extends NativeWorker {
  readonly record: {url: string; terminated: boolean};
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    this.record = {url: String(url), terminated: false};
    workers.push(this.record);
  }
  override terminate() {
    super.terminate();
    this.record.terminated = true;
  }
};
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
function equal(a: unknown, b: unknown, message: string) {
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );
}
async function record(name: string, evidence: unknown) {
  report.checks.push({name, at: new Date().toISOString(), evidence});
  status.textContent = JSON.stringify(report, null, 2);
  const response = await fetch('/__safari/report', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(report),
  });
  assert(response.ok, 'Report write failed');
}
function link(text: string, path: string) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = path;
  links.append(a);
}
const fixture = async (name: string) => {
  const r = await fetch(`/fixtures/${name}`);
  assert(r.ok, `Fixture missing: ${name}`);
  return r.text();
};
function expected(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  assert(
    parsed && typeof parsed === 'object' && 'rows' in parsed && Array.isArray(parsed.rows),
    'Invalid Golden',
  );
  return parsed.rows.map((row: unknown) => {
    assert(row && typeof row === 'object', 'Invalid Golden row');
    return Object.values(row).map((v) => (v === null ? null : String(v)));
  });
}
// Golden numeric cells compare as numbers; text IDs (including leading zeros)
// and NULL stay exact. Only these small, known fixture values are normalized.
function equalGolden(actual: readonly (readonly unknown[])[], raw: string, message: string) {
  const parsed: unknown = JSON.parse(raw);
  assert(
    parsed && typeof parsed === 'object' && 'rows' in parsed && Array.isArray(parsed.rows),
    'Invalid Golden',
  );
  const rows = parsed.rows.map((row: unknown) => {
    assert(row && typeof row === 'object', 'Invalid Golden row');
    return Object.values(row);
  });
  const normalized = actual.map((row, i) =>
    row.map((cell, j) => {
      if (typeof rows[i]?.[j] !== 'number') return cell;
      assert(
        typeof cell === 'string' && /^-?\d+(\.\d+)?$/.test(cell),
        'Invalid numeric fixture cell',
      );
      const value = Number(cell);
      assert(
        Number.isFinite(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER,
        'Unsafe fixture number',
      );
      return value;
    }),
  );
  equal(normalized, rows, message);
}
const signal = () => new AbortController().signal;
async function boot() {
  const result = await initializeServices();
  assert(result.ready && services.mode === 'persistent', JSON.stringify(result));
  assert(services.config, 'Config missing');
}
function state() {
  const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
  assert(
    raw &&
      typeof raw === 'object' &&
      'document' in raw &&
      'result' in raw &&
      'archive' in raw &&
      'report' in raw,
    'No completed pilot',
  );
  const doc = parseWorkspace(raw.document);
  assert(typeof raw.result === 'string' && typeof raw.archive === 'string', 'Invalid saved pilot');
  const savedReport = raw.report as Report;
  assert(savedReport.id && Array.isArray(savedReport.checks), 'Invalid saved report');
  return {
    document: doc,
    result: checkedId<'result'>(raw.result),
    archive: raw.archive,
    report: savedReport,
  };
}
async function start() {
  await boot();
  const existing = await services.workspaces.list();
  report.status = 'running';
  await record('native-browser-and-persistent-storage', {
    userAgent: navigator.userAgent,
    origin: location.origin,
    opfs: !!navigator.storage.getDirectory,
    locks: !!navigator.locks,
    existingProjects: existing.length,
    isolation: 'Each attempt creates a new workspace; existing projects remain untouched.',
  });
  const files = Object.fromEntries(
    await Promise.all(
      [
        'gemeinden.csv',
        'fahrzeuge.csv',
        'bevoelkerung.csv',
        '01-fahrzeuge-pro-1000.sql',
        '02-vergleich.R',
        '02b-plot.R',
        '03-klassifikation.sql',
        'golden/sql-2024.json',
        'golden/r-vergleich.json',
        'golden/rueck-sql.json',
      ].map(async (name) => [name, await fixture(name)]),
    ),
  );
  const fixtureKey = `proof-${crypto.randomUUID()}`;
  const engine = new DuckDbFileImportEngine(134217728);
  try {
    const p = await engine.preview(
      new File([files['bevoelkerung.csv']!], 'bevoelkerung.csv'),
      'csv',
      undefined,
      signal(),
    );
    const prepared = await engine.prepare(p.key, signal());
    const response = await fetch(`http://127.0.0.1:4174/__namedfile/${fixtureKey}`, {
      method: 'POST',
      body: await new Response(prepared.data).arrayBuffer(),
    });
    assert(response.ok, 'Fixture upload failed');
  } finally {
    await engine.dispose();
  }
  const created = await services.workspaces.create('Safari Golden Pilot');
  await record('created-test-workspace', {workspaceId: created.workspace.id, fixtureKey});
  const session = await services.workspaces.open(created.workspace.id);
  const ds = session.getDatasets(),
    sql = session.getAnalyses();
  for (const name of ['gemeinden', 'fahrzeuge']) {
    const preview = await ds.preview(
      new File([files[`${name}.csv`]!], `${name}.csv`),
      'csv',
      undefined,
      signal(),
    );
    await ds.confirm(preview.key, {name, sqlName: name, keepOriginal: true}, signal());
  }
  const access = new PortalAccess(services.config!, true);
  const [table] = await access.resolve(
    {providerId: 'fixture', target: {kind: 'dataset', entryId: fixtureKey}},
    signal(),
  );
  assert(table, 'Missing portal table');
  const pp = await ds.previewPortal(table, signal());
  const population = await ds.confirm(
    pp.key,
    {name: 'Bevölkerung aus Fixture-Portal', sqlName: 'bevoelkerung', keepOriginal: false},
    signal(),
  );
  const publicVersion =
    session.document.datasetVersions[session.document.datasets[population]!.currentVersionId]!;
  assert(publicVersion.backing.kind === 'public-parquet', 'Public reference not exercised');
  const query = session.createAnalysis('sql');
  session.updateAnalysis(query, {
    name: 'Golden SQL',
    code: files['01-fahrzeuge-pro-1000.sql']!,
    parameters: {jahr: 2024},
  });
  const run = await sql.run(query),
    result = session.document.runs[run]!.resultIds[0]!;
  const page = await sql.page(result, {offset: 0, size: 100, sort: []}, signal());
  await record('sql-observed-values', {
    rows: page.rows,
    expected: expected(files['golden/sql-2024.json']!),
  });
  equalGolden(page.rows, files['golden/sql-2024.json']!, 'Golden SQL');
  await record('mixed-local-public-golden-sql', {rows: page.rows, publicVersion});
  const r = session.createAnalysis('r'),
    rs = session.getR();
  session.updateAnalysis(r, {name: 'Golden R', code: files['02-vergleich.R']!});
  const plan = await rs.planToR(result, r, 'daten', signal());
  await rs.commitToR(
    plan.id,
    plan.issues.map((i) => i.id),
    signal(),
  );
  const rRun = await rs.run(r);
  assert(
    session.document.runs[rRun]!.status === 'succeeded',
    JSON.stringify(session.document.runs[rRun]),
  );
  const object = rs.objectList.find((o) => o.ref.name === 'vergleich')!;
  const preview = await rs.previewObject(object.ref, signal());
  equalGolden(preview.rows, files['golden/r-vergleich.json']!, 'Golden R');
  const backPlan = await rs.planFromR(object.ref, signal());
  await rs.commitFromR(
    backPlan.id,
    'vergleich',
    backPlan.issues.map((i) => i.id),
    signal(),
    {sqlName: 'vergleich'},
  );
  const returned = session.createAnalysis('sql');
  session.updateAnalysis(returned, {name: 'Rück-SQL', code: files['03-klassifikation.sql']!});
  const backRun = await sql.run(returned),
    backResult = session.document.runs[backRun]!.resultIds[0]!;
  const rows = await sql.page(backResult, {offset: 0, size: 100, sort: []}, signal());
  equal(rows.rows, expected(files['golden/rueck-sql.json']!), 'Return SQL');
  await sql.keep(backResult);
  await sql.saveVisualization(backResult, 'Safari Klassen', {
    type: 'bar',
    x: 'klasse',
    y: 'anzahl',
  });
  await record('golden-r-and-return-sql', {
    r: preview.rows,
    returned: rows.rows,
    completeTransfer: plan.rowCount,
  });
  const plotAnalysis = session.createAnalysis('r');
  session.updateAnalysis(plotAnalysis, {name: 'Golden Plot', code: files['02b-plot.R']!});
  const plotRun = await rs.run(plotAnalysis),
    plotResult = session.document.runs[plotRun]!.resultIds[0]!;
  const png = await rs.plot(plotResult, signal());
  assert(png.size > 1000 && png.type === 'image/png', 'Real PNG missing');
  await rs.keepPlot(plotResult);
  await ds.keepLocal(population, signal());
  const archive = await session.exportArchive(
    'with-data',
    {includeExternal: true, keepTemporary: false},
    signal(),
  );
  assert(archive.manifest.omissions.length === 0, 'Incomplete archive');
  await session.flush();
  const original = structuredClone(session.document);
  const bytes = new Uint8Array(await archive.blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  report.status = 'golden-passed-awaiting-tab-reopen';
  await record('png-archive-and-persistence', {
    pngBytes: png.size,
    archiveBytes: bytes.length,
    runCount: Object.keys(original.runs).length,
    runtime: original.runs[rRun]!.snapshot.runtime,
  });
  await services.workspaces.close();
  assert(
    workers.every((w) => w.terminated),
    'Native terminate was not called for every owned engine',
  );
  await record('native-worker-release-at-close', {workers});
  localStorage.setItem(
    key,
    JSON.stringify({document: original, result: backResult, archive: btoa(binary), report}),
  );
  link(
    'Gesichertes Rück-SQL in der Anwendung öffnen',
    `/workspaces/${original.workspace.id}/sql/${returned}`,
  );
  link(
    'Gesicherten R-Plot in der Anwendung öffnen',
    `/workspaces/${original.workspace.id}/r/${plotAnalysis}`,
  );
}
async function resume() {
  const saved = state();
  report = saved.report;
  report.status = 'checking-reopen';
  await boot();
  assert(workers.length === 0, 'Runtime before reopening');
  const session = await services.workspaces.open(saved.document.workspace.id);
  equal(
    Object.keys(session.document.runs),
    Object.keys(saved.document.runs),
    'No autorun after tab reopen',
  );
  equal(session.document.analyses, saved.document.analyses, 'Code survives tab reopen');
  assert(workers.length === 0, 'Opening metadata started a runtime');
  const rows = await session
    .getAnalyses()
    .page(saved.result, {offset: 0, size: 100, sort: []}, signal());
  equal(
    rows.rows,
    expected(await fixture('golden/rueck-sql.json')),
    'Persisted native OPFS result',
  );
  const bytes = Uint8Array.from(atob(saved.archive), (c) => c.charCodeAt(0));
  await services.workspaces.close();
  const before = workers.length;
  const candidate = await services.workspaces.getArchive().inspect(new Blob([bytes]), signal());
  const imported = await services.workspaces.importArchive(candidate.id, signal());
  assert(imported.workspace.id !== session.document.workspace.id, 'Archive IDs not remapped');
  assert(workers.length === before, 'Archive import started a runtime');
  const codes = (doc: WorkspaceDocument) =>
    Object.values(doc.analyses)
      .map((a) => a.code)
      .sort();
  equal(codes(imported), codes(saved.document), 'Archive code unchanged');
  const fresh = await services.workspaces.open(imported.workspace.id);
  const returnAnalysis = Object.values(fresh.document.analyses).find((a) => a.name === 'Rück-SQL')!;
  const back = Object.values(fresh.document.results).find(
    (r) => fresh.document.runs[r.runId]?.snapshot.analysisId === returnAnalysis.id,
  )!;
  const copyRows = await fresh
    .getAnalyses()
    .page(back.id, {offset: 0, size: 100, sort: []}, signal());
  equal(copyRows.rows, rows.rows, 'Archive data unchanged');
  equal(Object.keys(fresh.document.runs), Object.keys(imported.runs), 'Archive no autorun');
  await record('native-tab-reopen-and-archive', {
    rows: rows.rows,
    original: saved.document.workspace.id,
    imported: imported.workspace.id,
    nativeWorkerAutostart: false,
  });
  const r = fresh.createAnalysis('r'),
    rs = fresh.getR();
  fresh.updateAnalysis(r, {name: 'Safari Cancelprüfung', code: 'repeat { 1+1 }'});
  await rs.activate(r);
  const epoch = rs.epoch;
  const terminatedBefore = workers.filter((w) => w.terminated).length;
  const running = rs.run(r);
  const deadline = Date.now() + 15000;
  while (
    !Object.values(fresh.document.runs).some(
      (run) => run.snapshot.analysisId === r && run.status === 'running',
    )
  ) {
    assert(Date.now() < deadline, 'Loop did not start');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const cancelStart = Date.now();
  rs.cancel();
  const cancelled = await running;
  assert(fresh.document.runs[cancelled]!.status === 'cancelled', 'Loop not cancelled');
  assert(
    rs.epoch > epoch && workers.filter((w) => w.terminated).length > terminatedBefore,
    'Native R termination absent',
  );
  const cancelMs = Date.now() - cancelStart;
  assert(cancelMs < 10000, 'Cancel too slow');
  fresh.updateAnalysis(r, {code: 'cat(6*7)'});
  const after = await rs.run(r);
  assert(fresh.document.runs[after]!.status === 'succeeded', 'New native R failed');
  assert(
    rs.console(after).some((l) => l.text.includes('42')),
    'Follow-up R value missing',
  );
  await record('native-postmessage-cancel-and-new-r', {
    cancelMs,
    epochBefore: epoch,
    epochAfter: rs.epoch,
    followup: rs.console(after),
    nativeTerminateCalls: workers.filter((w) => w.terminated).length,
  });
  await fresh.flush();
  await services.workspaces.close();
  assert(
    workers.every((w) => w.terminated),
    'Owned worker not terminated',
  );
  report.status = 'passed';
  await record('safari-engine-pilot-passed', {
    workers,
    note: 'Actual Safari; native tab close/reopen, no full application quit; UI inspection recorded separately.',
  });
  link(
    'Importiertes Rück-SQL in der Anwendung öffnen',
    `/workspaces/${imported.workspace.id}/sql/${returnAnalysis.id}`,
  );
}
async function run(work: () => Promise<void>) {
  document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
  try {
    await work();
  } catch (error) {
    report.status = 'failed';
    report.error =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
        : String(error);
    await record('failure', report.error);
  } finally {
    document.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = false));
  }
}
async function verifyRestart() {
  const saved = state();
  report.status = 'checking-restart';
  await boot();
  const session = await services.workspaces.open(saved.document.workspace.id);
  equal(session.document.analyses, saved.document.analyses, 'Code after Safari restart');
  equal(session.document.runs, saved.document.runs, 'No autorun after Safari restart');
  equal(
    session.document.datasetVersions,
    saved.document.datasetVersions,
    'Historical provenance after restart',
  );
  equal(
    session.document.visualizations,
    saved.document.visualizations,
    'Saved chart after restart',
  );
  assert(workers.length === 0, 'Metadata reopen started an engine');
  const plot = Object.values(session.document.results).find((r) => r.kind === 'plot');
  assert(plot, 'Kept plot missing');
  const png = await session.getR().plot(plot.id, signal());
  assert(png.size > 1000, 'Kept PNG unreadable');
  equal(
    [...new Uint8Array(await png.slice(0, 8).arrayBuffer())],
    [137, 80, 78, 71, 13, 10, 26, 10],
    'Kept PNG signature',
  );
  assert(workers.length === 0, 'Kept PNG read started R');
  const rows = await session
    .getAnalyses()
    .page(saved.result, {offset: 0, size: 100, sort: []}, signal());
  equal(
    rows.rows,
    expected(await fixture('golden/rueck-sql.json')),
    'Kept Golden result after Safari restart',
  );
  await services.workspaces.close();
  assert(
    workers.every((w) => w.terminated),
    'Restart test leaked native worker',
  );
  report.status = 'passed';
  await record('persisted-state-after-operator-confirmed-restart', {
    sourcePilotId: saved.report.id,
    workspaceId: saved.document.workspace.id,
    rows: rows.rows,
    pngBytes: png.size,
    runs: Object.keys(saved.document.runs).length,
    workers,
    note: 'The test validates persistence; actual Safari process exit/relaunch must be documented by the operator separately.',
  });
}
document.querySelector('#start')!.addEventListener('click', () => {
  void run(start);
});
document.querySelector('#resume')!.addEventListener('click', () => {
  void run(resume);
});
document.querySelector('#restart')!.addEventListener('click', () => {
  void run(verifyRestart);
});
