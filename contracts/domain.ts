/**
 * Datenwerkstatt V1 — projektinterne Verträge, Spezifikation 1.0.0, 2026-10-03.
 * KEINE Drittanbieter-API und KEINE Anwendungsimplementierung.
 * JSON-Grenzen benötigen zusätzlich strikte Zod-Schemas + Referenzvalidierung.
 */
export type Id<K extends string> = string & {readonly __kind: K};
export type WorkspaceId = Id<'workspace'>;
export type DatasetId = Id<'dataset'>;
export type DatasetVersionId = Id<'dataset-version'>;
export type AnalysisId = Id<'analysis'>;
export type RunId = Id<'run'>;
export type ResultId = Id<'result'>;
export type ArtifactId = Id<'artifact'>;
export type VisualizationId = Id<'visualization'>;
export type IsoDateTime = string; // UTC RFC3339 mit Z
export type RowCount = string; // ^(0|[1-9][0-9]*)$
export type EngineId = 'duckdb-local' | 'webr-local';
export type ColumnRole = 'identifier' | 'label' | 'category' | 'measure' | 'date'
  | 'year' | 'geometry' | 'municipality' | 'unknown';

export interface ColumnSchema {
  name: string;
  logicalType: string; // vollständiger DuckDB-Typ, z.B. DECIMAL(18,4)
  nullable: boolean;
  roles: ColumnRole[];
  description?: string;
  metadata: Record<string, string>; // Einheit, CRS, Originalname, Faktor-Levels …
}
export interface TableSchema {
  columns: ColumnSchema[];
  metadata: Record<string, string>;
}
export interface Workspace {
  id: WorkspaceId;
  name: string;
  description?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type PortalTarget =
  | {kind: 'dataset'; entryId: string}
  | {kind: 'issue'; seriesId: string; issueId: string};
export interface CsvImportOptions {
  encoding: 'utf-8';
  delimiter: ',' | ';' | '\t' | '|';
  header: boolean;
  quote: '"';
  escape: '"';
  decimalSeparator: '.' | ',';
  nullStrings: string[];
  emptyStringIsNull: boolean;
  columns: {sourceIndex: number; name: string; logicalType: string}[];
}
export type DataOrigin =
  | {kind: 'portal'; providerId: string; target: PortalTarget;
     tableId: string; observedAt: IsoDateTime; canonicalUrl: string; license?: string}
  | {kind: 'file'; fileName: string; format: 'csv' | 'parquet';
     originalArtifactId?: ArtifactId; csvOptions?: CsvImportOptions}
  | {kind: 'result'; resultId: ResultId};

/** publisher-version/ETag sind KEINE durch die App geprüften Inhalts-Hashes. */
export type VersionEvidence =
  | {kind: 'sha256'; value: string}
  | {kind: 'publisher-version'; value: string}
  | {kind: 'unverified'};
export type TableBacking =
  | {kind: 'artifact'; artifactId: ArtifactId}
  | {kind: 'public-parquet'; url: string; etag?: string; lastModified?: string}
  | {kind: 'missing'; reason: 'recipe-import' | 'source-unavailable';
     expectedSha256?: string};
export interface Dataset {
  id: DatasetId;
  workspaceId: WorkspaceId;
  name: string;
  sqlName: string;
  currentVersionId: DatasetVersionId;
  createdAt: IsoDateTime;
  removedAt?: IsoDateTime; // Tombstone; Name bleibt reserviert.
}
export interface DatasetVersion {
  id: DatasetVersionId;
  workspaceId: WorkspaceId;
  datasetId: DatasetId;
  origin: DataOrigin;
  backing: TableBacking;
  evidence: VersionEvidence;
  schema: TableSchema;
  rowCount?: RowCount;
  createdAt: IsoDateTime;
}

export type TableInputRef =
  | {kind: 'dataset'; datasetId: DatasetId; versionId?: DatasetVersionId}
  | {kind: 'result'; resultId: ResultId};
export interface InputBinding {name: string; source: TableInputRef}
export type ParameterValue = string | number | boolean | null |
  {type: 'int64' | 'decimal' | 'date' | 'timestamp'; value: string};
export interface AnalysisBase {
  id: AnalysisId;
  workspaceId: WorkspaceId;
  name: string;
  code: string;
  revision: number;
  inputs: InputBinding[];
  parameters: Record<string, ParameterValue>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  archivedAt?: IsoDateTime;
}
export interface SqlAnalysis extends AnalysisBase {
  kind: 'sql';
  engineId: 'duckdb-local';
}
export interface RAnalysis extends AnalysisBase {
  kind: 'r';
  engineId: 'webr-local';
  environmentMode: 'workspace-session' | 'fresh-environment';
  randomSeed?: number;
}
export type Analysis = SqlAnalysis | RAnalysis;
export type ResolvedTableInput =
  | {kind: 'dataset-version'; bindingName: string; datasetId: DatasetId;
     versionId: DatasetVersionId; usage: 'bound' | 'possibly-used'}
  | {kind: 'result'; bindingName: string; resultId: ResultId; usage: 'bound'};
export interface RuntimeFingerprint {
  appBuildId: string;
  engineId: EngineId;
  engineVersion: string;
  transferCodecVersion: string;
  rVersion?: string;
  rPackageVersions?: Record<string, string>;
  locale?: string;
  timeZone: string;
}
export interface ExecutionSnapshot {
  analysisId?: AnalysisId;
  analysisRevision?: number;
  language: 'sql' | 'r';
  code: string;
  parameters: Record<string, ParameterValue>;
  resolvedInputs: ResolvedTableInput[];
  inputScope: 'workspace-snapshot' | 'explicit-bindings' | 'session-capture';
  runtime: RuntimeFingerprint;
  environmentMode?: RAnalysis['environmentMode'];
  randomSeed?: number;
  provenance: 'declared-inputs' | 'session-dependent' | 'untracked-sources';
  /** Keine Behauptung, alle im SQL verfügbaren Quellen seien tatsächlich gelesen. */
  notes: string[];
}
export type RunStatus = 'queued' | 'running' | 'cancelling' |
  'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface ExecutionRun {
  id: RunId;
  workspaceId: WorkspaceId;
  trigger: 'analysis' | 'r-object-capture';
  snapshot: ExecutionSnapshot;
  executedCode?: string;
  status: RunStatus;
  queuedAt: IsoDateTime;
  startedAt?: IsoDateTime;
  finishedAt?: IsoDateTime;
  durationMs?: number;
  stopReason?: 'user' | 'timeout' | 'workspace-close' | 'runtime-crash';
  error?: {code: string; message: string};
  warnings: string[];
  resultIds: ResultId[];
}
export type ResultMaterialization =
  | {kind: 'session'; sessionId: string; engineEpoch: number}
  | {kind: 'artifact'; artifactId: ArtifactId}
  | {kind: 'unavailable'; reason: 'session-ended' | 'runtime-reset' |
     'missing-artifact' | 'recipe-import' | 'discarded'};
export interface ResultBase {
  id: ResultId;
  workspaceId: WorkspaceId;
  runId: RunId;
  name: string;
  createdAt: IsoDateTime;
  retention: 'temporary' | 'kept';
  materialization: ResultMaterialization;
}
export interface TableResult extends ResultBase {
  kind: 'table';
  schema: TableSchema;
  rowCount: RowCount; // tatsächlich materialisierte Zeilen
  coverage: {kind: 'complete'} | {kind: 'limited'; maxRows: RowCount; reason: string};
}
export interface PlotResult extends ResultBase {
  kind: 'plot';
  mediaType: 'image/png';
  width: number;
  height: number;
}
export type Result = TableResult | PlotResult;
export interface Visualization {
  id: VisualizationId;
  workspaceId: WorkspaceId;
  name: string;
  tableResultId: ResultId;
  spec: {type: 'bar' | 'line' | 'scatter'; x: string; y: string; color?: string};
}
export interface Artifact {
  id: ArtifactId;
  workspaceId: WorkspaceId;
  path: string; // ausschliesslich von ArtifactStore abgeleitet
  mediaType: string;
  bytes: number;
  sha256: string;
  createdAt: IsoDateTime;
}
export interface WorkspaceDocument {
  formatVersion: 1;
  revision: number;
  workspace: Workspace;
  datasets: Record<DatasetId, Dataset>;
  datasetVersions: Record<DatasetVersionId, DatasetVersion>;
  analyses: Record<AnalysisId, Analysis>;
  runs: Record<RunId, ExecutionRun>;
  results: Record<ResultId, Result>;
  visualizations: Record<VisualizationId, Visualization>;
  artifacts: Record<ArtifactId, Artifact>;
}
export interface WorkspaceSummary {
  id: WorkspaceId;
  name: string;
  updatedAt: IsoDateTime;
  datasetCount: number;
  analysisCount: number;
}
export interface WorkspaceViewState {
  workspaceId: WorkspaceId;
  activeAnalysisId?: AnalysisId;
  openAnalysisIds: AnalysisId[];
  sidebarCollapsed: boolean;
  dataPanelVisible: boolean;
  sqlEditorFraction: number;
  rEditorFraction: number;
  rConsoleFraction: number;
  rConsoleVisible: boolean;
  rObjectsVisible: boolean;
}
export interface AppSettings {
  id: 'default';
  editorFontSize: number;
  showLineNumbers: boolean;
  wordWrap: boolean;
  sidebarCollapsed: boolean;
}
