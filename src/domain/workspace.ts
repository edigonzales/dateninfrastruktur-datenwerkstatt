import {z} from 'zod';
import type {Id, WorkspaceDocument, WorkspaceId} from './model';
export const uuidSchema = z.uuid();
export function checkedId<K extends string>(id: string): Id<K> {
  return uuidSchema.parse(id) as Id<K>;
}
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((s) => !/[\u0000-\u001f\u007f]/u.test(s), 'Keine Steuerzeichen erlaubt.');
export const sqlNameSchema = z
  .string()
  .regex(/^[a-z_][a-z0-9_]{0,62}$/)
  .refine((s) => !s.startsWith('__dw_'), 'Reservierter SQL-Name.');
const reservedR = new Set([
  'if',
  'else',
  'repeat',
  'while',
  'function',
  'for',
  'in',
  'next',
  'break',
  'TRUE',
  'FALSE',
  'NULL',
  'Inf',
  'NaN',
  'NA',
  'NA_integer_',
  'NA_real_',
  'NA_complex_',
  'NA_character_',
  'params',
]);
export const bindingNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  .refine((s) => !reservedR.has(s) && !s.startsWith('lab_'), 'Reservierter R-Name.');
const date = z.iso.datetime();
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const textMap = z.record(z.string(), z.string());
const column = z.strictObject({
  name: z.string().min(1),
  logicalType: z.string().min(1),
  nullable: z.boolean(),
  roles: z.array(
    z.enum([
      'identifier',
      'label',
      'category',
      'measure',
      'date',
      'year',
      'geometry',
      'municipality',
      'unknown',
    ]),
  ),
  description: z.string().optional(),
  metadata: textMap,
});
export const tableSchema = z
  .strictObject({columns: z.array(column), metadata: textMap})
  .refine(
    (t) => new Set(t.columns.map((c) => c.name)).size === t.columns.length,
    'Doppelte Spaltennamen.',
  );
const csv = z.strictObject({
  encoding: z.literal('utf-8'),
  delimiter: z.enum([',', ';', '\t', '|']),
  header: z.boolean(),
  quote: z.literal('"'),
  escape: z.literal('"'),
  decimalSeparator: z.enum(['.', ',']),
  nullStrings: z.array(z.string()),
  emptyStringIsNull: z.boolean(),
  columns: z.array(
    z.strictObject({sourceIndex: natural, name: z.string().min(1), logicalType: z.string().min(1)}),
  ),
});
const target = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('dataset'), entryId: z.string().min(1)}),
  z.strictObject({
    kind: z.literal('issue'),
    seriesId: z.string().min(1),
    issueId: z
      .string()
      .min(1)
      .refine((s) => s !== 'current'),
  }),
]);
const origin = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('portal'),
    providerId: z.string().min(1),
    target,
    tableId: z.string().min(1),
    observedAt: date,
    canonicalUrl: z.url(),
    license: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('file'),
    fileName: z.string().min(1),
    format: z.enum(['csv', 'parquet']),
    originalArtifactId: uuidSchema.optional(),
    csvOptions: csv.optional(),
  }),
  z.strictObject({kind: z.literal('result'), resultId: uuidSchema}),
]);
const evidence = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('sha256'), value: hash}),
  z.strictObject({kind: z.literal('publisher-version'), value: z.string().min(1)}),
  z.strictObject({kind: z.literal('unverified')}),
]);
const backing = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('artifact'), artifactId: uuidSchema}),
  z.strictObject({
    kind: z.literal('public-parquet'),
    url: z.url(),
    etag: z.string().optional(),
    lastModified: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal('missing'),
    reason: z.enum(['recipe-import', 'source-unavailable']),
    expectedSha256: hash.optional(),
  }),
]);
const owned = {id: uuidSchema, workspaceId: uuidSchema};
const dataset = z.strictObject({
  ...owned,
  name: nameSchema,
  sqlName: sqlNameSchema,
  currentVersionId: uuidSchema,
  createdAt: date,
  removedAt: date.optional(),
});
const version = z.strictObject({
  ...owned,
  datasetId: uuidSchema,
  origin,
  backing,
  evidence,
  schema: tableSchema,
  rowCount: count.optional(),
  createdAt: date,
});
const input = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('dataset'),
    datasetId: uuidSchema,
    versionId: uuidSchema.optional(),
  }),
  z.strictObject({kind: z.literal('result'), resultId: uuidSchema}),
]);
export const parameterSchema = z.union([
  z.string(),
  z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  z.boolean(),
  z.null(),
  z
    .strictObject({type: z.enum(['int64', 'decimal', 'date', 'timestamp']), value: z.string()})
    .refine((p) => {
      switch (p.type) {
        case 'int64':
          return (
            /^[+-]?[0-9]+$/.test(p.value) &&
            BigInt(p.value) >= -9223372036854775808n &&
            BigInt(p.value) <= 9223372036854775807n
          );
        case 'decimal':
          return /^[+-]?[0-9]+(?:\.[0-9]+)?$/.test(p.value);
        case 'date':
          return z.iso.date().safeParse(p.value).success;
        case 'timestamp':
          return z.iso.datetime({offset: true}).safeParse(p.value).success;
      }
    }, 'Ungültiger typisierter Parameter.'),
]);
const analysisBase = {
  ...owned,
  name: nameSchema,
  code: z.string(),
  revision: natural,
  inputs: z.array(z.strictObject({name: bindingNameSchema, source: input})),
  parameters: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), parameterSchema),
  createdAt: date,
  updatedAt: date,
  archivedAt: date.optional(),
};
const analysis = z.discriminatedUnion('kind', [
  z.strictObject({...analysisBase, kind: z.literal('sql'), engineId: z.literal('duckdb-local')}),
  z.strictObject({
    ...analysisBase,
    kind: z.literal('r'),
    engineId: z.literal('webr-local'),
    environmentMode: z.enum(['workspace-session', 'fresh-environment']),
    randomSeed: z.number().int().min(0).max(2147483647).optional(),
  }),
]);
const resolvedInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('dataset-version'),
    bindingName: z.string(),
    datasetId: uuidSchema,
    versionId: uuidSchema,
    usage: z.enum(['bound', 'possibly-used']),
  }),
  z.strictObject({
    kind: z.literal('result'),
    bindingName: z.string(),
    resultId: uuidSchema,
    usage: z.literal('bound'),
  }),
]);
const fingerprint = z.strictObject({
  appBuildId: z.string(),
  engineId: z.enum(['duckdb-local', 'webr-local']),
  engineVersion: z.string(),
  transferCodecVersion: z.string(),
  rVersion: z.string().optional(),
  rPackageVersions: textMap.optional(),
  locale: z.string().optional(),
  timeZone: z.string(),
});
const snapshot = z.strictObject({
  analysisId: uuidSchema.optional(),
  analysisRevision: natural.optional(),
  language: z.enum(['sql', 'r']),
  code: z.string(),
  parameters: analysisBase.parameters,
  resolvedInputs: z.array(resolvedInput),
  inputScope: z.enum(['workspace-snapshot', 'explicit-bindings', 'session-capture']),
  runtime: fingerprint,
  environmentMode: z.enum(['workspace-session', 'fresh-environment']).optional(),
  randomSeed: z.number().int().optional(),
  provenance: z.enum(['declared-inputs', 'session-dependent', 'untracked-sources']),
  notes: z.array(z.string()),
});
const run = z.strictObject({
  ...owned,
  trigger: z.enum(['analysis', 'r-object-capture']),
  snapshot,
  executedCode: z.string().optional(),
  status: z.enum([
    'queued',
    'running',
    'cancelling',
    'succeeded',
    'failed',
    'cancelled',
    'interrupted',
  ]),
  queuedAt: date,
  startedAt: date.optional(),
  finishedAt: date.optional(),
  durationMs: z.number().nonnegative().optional(),
  stopReason: z.enum(['user', 'timeout', 'workspace-close', 'runtime-crash']).optional(),
  error: z.strictObject({code: z.string(), message: z.string()}).optional(),
  warnings: z.array(z.string()),
  resultIds: z.array(uuidSchema),
});
const materialization = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('session'), sessionId: uuidSchema, engineEpoch: natural}),
  z.strictObject({kind: z.literal('artifact'), artifactId: uuidSchema}),
  z.strictObject({
    kind: z.literal('unavailable'),
    reason: z.enum([
      'session-ended',
      'runtime-reset',
      'missing-artifact',
      'recipe-import',
      'discarded',
    ]),
  }),
]);
const resultBase = {
  ...owned,
  runId: uuidSchema,
  name: nameSchema,
  createdAt: date,
  retention: z.enum(['temporary', 'kept']),
  materialization,
};
const result = z.discriminatedUnion('kind', [
  z.strictObject({
    ...resultBase,
    kind: z.literal('table'),
    schema: tableSchema,
    rowCount: count,
    coverage: z.discriminatedUnion('kind', [
      z.strictObject({kind: z.literal('complete')}),
      z.strictObject({kind: z.literal('limited'), maxRows: count, reason: z.string()}),
    ]),
  }),
  z.strictObject({
    ...resultBase,
    kind: z.literal('plot'),
    mediaType: z.literal('image/png'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
]);
const visualization = z.strictObject({
  ...owned,
  name: nameSchema,
  tableResultId: uuidSchema,
  spec: z.strictObject({
    type: z.enum(['bar', 'line', 'scatter']),
    x: z.string(),
    y: z.string(),
    color: z.string().optional(),
  }),
});
const artifact = z.strictObject({
  ...owned,
  path: z.string(),
  mediaType: z.string().min(1),
  bytes: natural,
  sha256: hash,
  createdAt: date,
});
export const workspaceSchema = z.strictObject({
  formatVersion: z.literal(1),
  revision: natural,
  workspace: z.strictObject({
    id: uuidSchema,
    name: nameSchema,
    description: z.string().max(4000).optional(),
    createdAt: date,
    updatedAt: date,
  }),
  datasets: z.record(uuidSchema, dataset),
  datasetVersions: z.record(uuidSchema, version),
  analyses: z.record(uuidSchema, analysis),
  runs: z.record(uuidSchema, run),
  results: z.record(uuidSchema, result),
  visualizations: z.record(uuidSchema, visualization),
  artifacts: z.record(uuidSchema, artifact),
});

export class WorkspaceValidationError extends Error {
  constructor(
    public readonly code: 'VALIDATION_FAILED' | 'REFERENCE_INVALID' | 'FORMAT_UNSUPPORTED',
    message: string,
    public readonly path: string,
  ) {
    super(message);
  }
}
export function parseWorkspace(raw: unknown): WorkspaceDocument {
  if (typeof raw === 'object' && raw !== null && 'formatVersion' in raw && raw.formatVersion !== 1)
    throw new WorkspaceValidationError(
      'FORMAT_UNSUPPORTED',
      'Unbekannte Projektversion.',
      'formatVersion',
    );
  const parsed = workspaceSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new WorkspaceValidationError('VALIDATION_FAILED', issue.message, issue.path.join('.'));
  }
  // All scalars/records have been validated; the cast only adds project UUID brands.
  const d = parsed.data as WorkspaceDocument;
  const fail = (path: string, message: string): never => {
    throw new WorkspaceValidationError('REFERENCE_INVALID', message, path);
  };
  for (const collection of [
    'datasets',
    'datasetVersions',
    'analyses',
    'runs',
    'results',
    'visualizations',
    'artifacts',
  ] as const) {
    for (const [key, entity] of Object.entries(d[collection])) {
      if (key !== entity.id)
        fail(`${collection}.${key}.id`, 'Schlüssel und ID stimmen nicht überein.');
      if (entity.workspaceId !== d.workspace.id)
        fail(`${collection}.${key}.workspaceId`, 'Fremder Workspace.');
    }
  }
  const tableRef = (id: string, path: string) => {
    if (d.results[id as keyof typeof d.results]?.kind !== 'table')
      fail(path, 'Tabellenresultat fehlt.');
  };
  const artifactRef = (id: string, path: string) => {
    if (!d.artifacts[id as keyof typeof d.artifacts]) fail(path, 'Artefaktmetadaten fehlen.');
  };
  const versionRef = (id: string, ds: string, path: string) => {
    if (d.datasetVersions[id as keyof typeof d.datasetVersions]?.datasetId !== ds)
      fail(path, 'Datensatzversion fehlt oder gehört zu anderem Datensatz.');
  };
  const names = new Set<string>();
  for (const ds of Object.values(d.datasets)) {
    if (names.has(ds.sqlName)) fail(`datasets.${ds.id}.sqlName`, 'SQL-Name bereits reserviert.');
    names.add(ds.sqlName);
    versionRef(ds.currentVersionId, ds.id, `datasets.${ds.id}.currentVersionId`);
  }
  for (const v of Object.values(d.datasetVersions)) {
    if (!d.datasets[v.datasetId]) fail(`datasetVersions.${v.id}.datasetId`, 'Datensatz fehlt.');
    if (v.backing.kind === 'artifact')
      artifactRef(v.backing.artifactId, `datasetVersions.${v.id}.backing`);
    if (v.origin.kind === 'file' && v.origin.originalArtifactId)
      artifactRef(v.origin.originalArtifactId, `datasetVersions.${v.id}.origin`);
    if (v.origin.kind === 'result') tableRef(v.origin.resultId, `datasetVersions.${v.id}.origin`);
  }
  for (const a of Object.values(d.analyses)) {
    const bindings = new Set<string>();
    for (const binding of a.inputs) {
      const p = `analyses.${a.id}.inputs.${binding.name}`;
      if (bindings.has(binding.name)) fail(p, 'Doppelte Bindung.');
      bindings.add(binding.name);
      const ref = binding.source;
      if (ref.kind === 'result') {
        tableRef(ref.resultId, p);
        const r = d.results[ref.resultId]!;
        if (r.materialization.kind === 'session')
          fail(p, 'Dauerhafte Eingabe muss vorher gesichert werden.');
      } else {
        if (!d.datasets[ref.datasetId]) fail(p, 'Datensatz fehlt.');
        if (ref.versionId) versionRef(ref.versionId, ref.datasetId, p);
      }
    }
  }
  for (const r of Object.values(d.runs)) {
    const p = `runs.${r.id}`;
    if (r.trigger === 'analysis' && (!r.snapshot.analysisId || !d.analyses[r.snapshot.analysisId]))
      fail(`${p}.snapshot.analysisId`, 'Analyse fehlt.');
    if (r.snapshot.analysisId && d.analyses[r.snapshot.analysisId]?.kind !== r.snapshot.language)
      fail(`${p}.snapshot.language`, 'Falsche Analysesprache.');
    if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(r.status) && !r.finishedAt)
      fail(`${p}.finishedAt`, 'Endzeit fehlt.');
    if (new Set(r.resultIds).size !== r.resultIds.length)
      fail(`${p}.resultIds`, 'Doppeltes Resultat.');
    for (const id of r.resultIds)
      if (d.results[id]?.runId !== r.id)
        fail(`${p}.resultIds`, 'Resultat/Lauf stimmt nicht überein.');
    if (r.resultIds.length && r.status !== 'succeeded')
      fail(`${p}.resultIds`, 'Nur erfolgreiche Läufe veröffentlichen Resultate.');
    for (const ref of r.snapshot.resolvedInputs) {
      if (ref.kind === 'result') tableRef(ref.resultId, `${p}.snapshot.resolvedInputs`);
      else versionRef(ref.versionId, ref.datasetId, `${p}.snapshot.resolvedInputs`);
    }
  }
  for (const r of Object.values(d.results)) {
    if (!d.runs[r.runId]?.resultIds.includes(r.id))
      fail(`results.${r.id}.runId`, 'Resultat im Lauf nicht registriert.');
    if (r.materialization.kind === 'artifact')
      artifactRef(r.materialization.artifactId, `results.${r.id}.materialization`);
    if (r.retention === 'kept' && r.materialization.kind === 'session')
      fail(`results.${r.id}.retention`, 'Aufbewahrtes Resultat braucht Artefakt.');
  }
  for (const v of Object.values(d.visualizations)) {
    tableRef(v.tableResultId, `visualizations.${v.id}.tableResultId`);
    if (d.results[v.tableResultId]?.materialization.kind === 'session')
      fail(`visualizations.${v.id}`, 'Diagrammquelle muss gesichert werden.');
  }
  for (const a of Object.values(d.artifacts))
    if (
      !a.path.startsWith(`workspaces/${d.workspace.id}/`) ||
      a.path.includes('..') ||
      a.path.includes('\\') ||
      a.path.includes('\0')
    )
      fail(`artifacts.${a.id}.path`, 'Ungültiger verwalteter Artefaktpfad.');
  return d;
}
export function emptyWorkspace(id: WorkspaceId, name: string, now: string): WorkspaceDocument {
  return parseWorkspace({
    formatVersion: 1,
    revision: 0,
    workspace: {id, name, createdAt: now, updatedAt: now},
    datasets: {},
    datasetVersions: {},
    analyses: {},
    runs: {},
    results: {},
    visualizations: {},
    artifacts: {},
  });
}
export function suggestSqlName(display: string, used: Iterable<string>): string {
  const reserved = new Set(used);
  let base = display
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z_]/.test(base)) base = `_${base}`;
  if (!base || base.startsWith('__dw_')) base = `daten_${base}`;
  base = base.slice(0, 63);
  let candidate = base;
  let i = 2;
  while (reserved.has(candidate)) {
    const suffix = `_${i++}`;
    candidate = base.slice(0, 63 - suffix.length) + suffix;
  }
  return candidate;
}
