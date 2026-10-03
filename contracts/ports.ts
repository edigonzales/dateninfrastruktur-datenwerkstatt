/** Projektinterne Ports. Implementierungen und Drittanbieter-API-Anpassungen sind Aufgabe des Agenten. */
import type {
  AnalysisId, Artifact, ArtifactId, ColumnSchema, DatasetVersion, ExecutionSnapshot,
  ResultId, RunId, RuntimeFingerprint, TableSchema, WorkspaceDocument,
  WorkspaceId, WorkspaceSummary,
} from './domain';

export interface WorkspaceRepository {
  list(): Promise<WorkspaceSummary[]>;
  load(id: WorkspaceId): Promise<WorkspaceDocument | undefined>;
  create(document: WorkspaceDocument): Promise<WorkspaceDocument>;
  commit(document: WorkspaceDocument, expectedRevision: number): Promise<WorkspaceDocument>;
  remove(id: WorkspaceId, expectedRevision: number): Promise<void>;
}
export interface ArtifactStore {
  write(workspaceId: WorkspaceId, data: ReadableStream<Uint8Array>,
    mediaType: string, signal: AbortSignal): Promise<Artifact>;
  read(artifact: Artifact, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  exists(artifact: Artifact): Promise<boolean>;
  verify(artifact: Artifact, signal: AbortSignal): Promise<'valid' | 'missing' | 'corrupt'>;
  delete(artifact: Artifact): Promise<void>;
  list(workspaceId: WorkspaceId): AsyncIterable<{path: string; bytes: number}>;
}
export interface WorkspaceLease {
  workspaceId: WorkspaceId;
  mode: 'writer' | 'reader';
  release(): Promise<void>;
}
export interface WorkspaceLock {
  acquire(workspaceId: WorkspaceId, signal: AbortSignal): Promise<WorkspaceLease>;
}
export interface ExecutionBudget {
  maxExecutionMs: number;
  maxResultRows: number;
  maxResultBytes: number;
  maxTransferBytes: number;
}
/** Laufzeitreferenz; weder OPFS-Pfad noch serialisierter Storezustand. */
export interface TableHandle {
  sessionId: string;
  engineEpoch: number;
  key: string;
  schema: TableSchema;
  rowCount: string;
}
export interface SqlExecutionRequest {
  runId: RunId;
  snapshot: ExecutionSnapshot;
  budget: ExecutionBudget;
  signal: AbortSignal;
}
export interface SqlExecutionResponse {
  table: TableHandle;
  executedCode: string;
  limited: boolean;
  warnings: string[];
}
export interface PageRequest {
  offset: number;
  size: number;
  sort: {column: string; direction: 'asc' | 'desc'}[];
}
export interface ResultPage {
  rows: readonly (readonly unknown[])[];
  totalRows: string;
}
export interface ArrowIpcStream {schema: TableSchema; chunks: AsyncIterable<Uint8Array>}
export interface SqlEngine {
  initialize(signal: AbortSignal): Promise<void>;
  fingerprint(): Promise<RuntimeFingerprint>;
  registerDataset(version: DatasetVersion, sqlName: string, signal: AbortSignal): Promise<void>;
  execute(request: SqlExecutionRequest): Promise<SqlExecutionResponse>;
  readPage(table: TableHandle, request: PageRequest, signal: AbortSignal): Promise<ResultPage>;
  exportArrow(table: TableHandle, signal: AbortSignal): Promise<ArrowIpcStream>;
  importArrow(data: ArrowIpcStream, signal: AbortSignal): Promise<TableHandle>;
  writeParquet(table: TableHandle, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
  release(table: TableHandle): Promise<void>;
  cancel(runId: RunId): Promise<'interrupted' | 'runtime-reset' | 'already-settled'>;
  dispose(): Promise<void>;
}
export type ColumnVector = {schema: ColumnSchema; validity: Uint8Array} & (
  | {encoding: 'float64'; values: Float64Array}
  | {encoding: 'int32'; values: Int32Array}
  | {encoding: 'boolean'; values: Uint8Array}
  | {encoding: 'text'; values: string[]}
  | {encoding: 'binary'; values: Uint8Array[]}
);
export interface ConversionIssue {
  /** Innerhalb eines Transferplans stabile ID für explizite Bestätigungen. */
  id: string;
  column: string;
  kind: 'representation-change' | 'precision-loss' | 'unsupported-type';
  message: string;
  requiresApproval: boolean;
}
/** V1 bounded payload, keine Zero-Copy-Zusage. validity: 0=fehlend, 1=gültig. */
export interface ColumnarPayload {
  schema: TableSchema;
  rowCount: number;
  columns: ColumnVector[];
  issues: ConversionIssue[];
}
export interface RScope {sessionId: string; engineEpoch: number; key: string}
export interface RObjectRef {scope: RScope; name: string}
export interface RObjectSummary {
  ref: RObjectRef;
  classes: string[];
  isDataFrame: boolean;
  rowCount?: number;
  columnCount?: number;
}
export type ROutputEvent =
  | {kind: 'stdout' | 'stderr' | 'warning' | 'message'; text: string}
  | {kind: 'plot'; image: ImageBitmap};
export interface REngine {
  initialize(signal: AbortSignal): Promise<void>;
  fingerprint(): Promise<RuntimeFingerprint>;
  supportsInterrupt(): boolean;
  createScope(mode: 'workspace-session' | 'fresh-environment'): Promise<RScope>;
  bindDataFrame(scope: RScope, name: string, payload: ColumnarPayload, signal: AbortSignal): Promise<void>;
  evaluate(scope: RScope, runId: RunId, snapshot: ExecutionSnapshot,
    onOutput: (event: ROutputEvent) => void, signal: AbortSignal): Promise<void>;
  listObjects(scope: RScope): Promise<RObjectSummary[]>;
  readDataFrame(ref: RObjectRef, signal: AbortSignal): Promise<ColumnarPayload>;
  releaseScope(scope: RScope): Promise<void>;
  cancel(runId: RunId): Promise<'interrupted' | 'runtime-reset' | 'already-settled'>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}
export interface TransferPlan {
  id: string;
  rowCount: string;
  estimatedBytes: number;
  requiresApproval: boolean;
  issues: ConversionIssue[];
}
export interface TableTransferService {
  planToR(resultId: ResultId, analysisId: AnalysisId, variableName: string,
    signal: AbortSignal): Promise<TransferPlan>;
  /** Plan ist an Quellversion/Result-ID gebunden; wird nach Änderungen ungültig. */
  commitToR(planId: string, approvedIssues: string[], signal: AbortSignal): Promise<void>;
  planFromR(ref: RObjectRef, signal: AbortSignal): Promise<TransferPlan>;
  commitFromR(planId: string, datasetName: string, approvedIssues: string[],
    signal: AbortSignal): Promise<void>;
}
export interface SessionResultRegistry {
  get(resultId: ResultId): TableHandle | undefined;
  put(resultId: ResultId, handle: TableHandle): void;
  remove(resultId: ResultId): Promise<void>;
  clear(): Promise<void>;
}
export interface BrowserCapabilities {
  indexedDb: boolean;
  opfs: boolean;
  webLocks: boolean;
  crossOriginIsolated: boolean;
}
export interface WorkspaceSession {
  workspaceId: WorkspaceId;
  sessionId: string;
  lease: WorkspaceLease;
  sql: SqlEngine;
  getR(): Promise<REngine>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
export interface ArtifactReferenceCheck {
  referenced: ArtifactId[];
  missing: ArtifactId[];
  corrupt: ArtifactId[];
  orphanPaths: string[];
}
export type AppErrorCode =
  | 'VALIDATION_FAILED' | 'REFERENCE_INVALID' | 'REVISION_CONFLICT'
  | 'READ_ONLY_WORKSPACE' | 'CAPABILITY_UNAVAILABLE' | 'STORAGE_QUOTA'
  | 'ARTIFACT_MISSING' | 'ARTIFACT_CORRUPT' | 'FORMAT_UNSUPPORTED'
  | 'IMPORT_INVALID' | 'LIMIT_EXCEEDED' | 'SQL_NOT_ALLOWED' | 'SQL_ERROR'
  | 'R_ERROR' | 'TYPE_UNSUPPORTED' | 'CONVERSION_APPROVAL_REQUIRED'
  | 'SOURCE_UNAVAILABLE' | 'SOURCE_CHANGED' | 'NETWORK_POLICY'
  | 'RUNTIME_RESET' | 'CANCELLED' | 'TIMEOUT' | 'ARCHIVE_INVALID';
export interface AppError {code: AppErrorCode; message: string; retryable: boolean; details?: string}
