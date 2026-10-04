import {fromTextRows, payloadBytes} from './rTypeCodec';
import type {
  AnalysisId,
  ExecutionRun,
  ExecutionSnapshot,
  Id,
  ResultId,
  TableResult,
  WorkspaceDocument,
  Visualization,
  DatasetId,
} from '../domain/model';
import {transitionRun} from '../domain/run';
import {nameSchema, sqlNameSchema} from '../domain/workspace';
import type {ArtifactStore, ExecutionBudget, PageRequest, TableHandle} from './ports';
import type {ResultSqlEngine} from './sqlPorts';
import {WorkspaceScheduler} from './scheduler';
import {AppFailure} from './errors';
interface Dependencies {
  sessionId: string;
  document(): WorkspaceDocument;
  edit(change: (d: WorkspaceDocument) => void): void;
  publish(change: (d: WorkspaceDocument) => void): Promise<void>;
  flush(): Promise<void>;
  assertWriter(): void;
  sql: ResultSqlEngine;
  scheduler: WorkspaceScheduler;
  artifacts: ArtifactStore;
  budget: ExecutionBudget;
  newId: <K extends string>() => Id<K>;
  now(): string;
}
export class AnalysisService {
  private results = new Map<ResultId, TableHandle>();
  private restoring = new Map<ResultId, Promise<TableHandle>>();
  private active: ExecutionRun['id'] | undefined;
  private stopReason: ExecutionRun['stopReason'];
  constructor(private readonly deps: Dependencies) {}
  get sql() {
    return this.deps.sql;
  }
  run(analysisId: AnalysisId, selection?: string) {
    this.deps.assertWriter();
    const doc = structuredClone(this.deps.document());
    const analysis = doc.analyses[analysisId];
    if (!analysis || analysis.kind !== 'sql' || analysis.archivedAt)
      throw new AppFailure('REFERENCE_INVALID', 'SQL-Analyse fehlt.');
    // Freeze editable fields before the first asynchronous operation.
    return this.deps.scheduler.run(
      'SQL ausführen',
      new AbortController().signal,
      async (signal) => {
        await this.sql.initialize(signal);
        const snapshot: ExecutionSnapshot = {
          analysisId,
          analysisRevision: analysis.revision,
          language: 'sql',
          code: selection?.trim() ? selection : analysis.code,
          parameters: analysis.parameters,
          inputScope: 'workspace-snapshot',
          provenance: 'declared-inputs',
          resolvedInputs: Object.values(doc.datasets)
            .filter((d) => !d.removedAt)
            .map((d) => ({
              kind: 'dataset-version',
              datasetId: d.id,
              versionId: d.currentVersionId,
              bindingName: d.sqlName,
              usage: 'possibly-used',
            })),
          runtime: await this.sql.fingerprint(),
          notes: [
            ...(selection?.trim() ? ['Explizit markierter SQL-Code ausgeführt.'] : []),
            'Snapshot aller verfügbaren Dateneinbindungen; tatsächliche Nutzung nicht vollständig ermittelt.',
          ],
        };
        signal.throwIfAborted();
        const id = this.deps.newId<'run'>();
        const run: ExecutionRun = {
          id,
          workspaceId: doc.workspace.id,
          trigger: 'analysis',
          snapshot,
          status: 'queued',
          queuedAt: this.deps.now(),
          warnings: [],
          resultIds: [],
        };
        await this.deps.publish((d) => {
          d.runs[id] = run;
        });
        this.active = id;
        this.stopReason = undefined;
        const controller = new AbortController();
        const joined = AbortSignal.any([signal, controller.signal]);
        const cancel = () => {
          this.deps.edit((d) => {
            const r = d.runs[id]!;
            if (r.status === 'running') transitionRun(r, 'cancelling');
          });
        };
        joined.addEventListener('abort', cancel, {once: true});
        const start = Date.now();
        let handle: TableHandle | undefined;
        let pendingResultId: ResultId | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          joined.throwIfAborted();
          this.deps.edit((d) => {
            transitionRun(d.runs[id]!, 'running');
            d.runs[id]!.startedAt = this.deps.now();
          });
          timer = setTimeout(() => {
            this.stopReason = 'timeout';
            controller.abort();
          }, this.deps.budget.maxExecutionMs);
          for (const input of snapshot.resolvedInputs)
            if (input.kind === 'dataset-version') {
              await this.sql.registerDataset(
                doc.datasetVersions[input.versionId]!,
                input.bindingName,
                joined,
              );
            }
          const response = await this.sql.execute({
            runId: id,
            snapshot,
            budget: this.deps.budget,
            signal: joined,
          });
          handle = response.table;
          joined.throwIfAborted();
          // Success won. Remove cancellation before the atomic metadata publication.
          clearTimeout(timer);
          joined.removeEventListener('abort', cancel);
          this.active = undefined;
          const resultId = this.deps.newId<'result'>();
          const result: TableResult = {
            id: resultId,
            workspaceId: doc.workspace.id,
            runId: id,
            kind: 'table',
            name: analysis.name,
            createdAt: this.deps.now(),
            retention: 'temporary',
            materialization: {
              kind: 'session',
              sessionId: this.deps.sessionId,
              engineEpoch: handle.engineEpoch,
            },
            schema: handle.schema,
            rowCount: handle.rowCount,
            coverage: response.limited
              ? {
                  kind: 'limited',
                  maxRows: String(this.deps.budget.maxResultRows),
                  reason: 'App-Zeilenlimit',
                }
              : {kind: 'complete'},
          };
          const durationMs = Date.now() - start;
          pendingResultId = resultId;
          this.results.set(resultId, handle);
          await this.deps.publish((d) => {
            const r = d.runs[id]!;
            transitionRun(r, 'succeeded');
            r.finishedAt = result.createdAt;
            r.durationMs = durationMs;
            r.executedCode = response.executedCode;
            r.warnings = response.warnings;
            r.resultIds = [resultId];
            d.results[resultId] = result;
          });
          handle = undefined;
          pendingResultId = undefined;
        } catch (error) {
          if (pendingResultId) this.results.delete(pendingResultId);
          if (handle) await this.sql.release(handle);
          const cancelled =
            joined.aborted && !(error instanceof AppFailure && error.code === 'RUNTIME_RESET');
          this.deps.edit((d) => {
            const r = d.runs[id]!;
            transitionRun(r, cancelled ? 'cancelled' : 'failed');
            r.finishedAt = this.deps.now();
            r.durationMs = Date.now() - start;
            if (cancelled) r.stopReason = this.stopReason ?? 'user';
            r.error = {
              code: cancelled
                ? this.stopReason === 'timeout'
                  ? 'TIMEOUT'
                  : 'CANCELLED'
                : error instanceof AppFailure
                  ? error.code
                  : 'SQL_ERROR',
              message: error instanceof Error ? error.message : String(error),
            };
          });
        } finally {
          clearTimeout(timer);
          joined.removeEventListener('abort', cancel);
          this.active = undefined;
          this.invalidateResetResults();
          await this.deps.flush();
        }
        return id;
      },
    );
  }
  cancel(reason: 'user' | 'workspace-close' = 'user') {
    if (!this.active && this.deps.scheduler.getSnapshot() !== 'SQL ausführen') return;
    this.stopReason = reason;
    this.deps.scheduler.cancel();
  }
  private invalidateResetResults() {
    const stale = Object.values(this.deps.document().results).filter(
      (r) =>
        r.kind === 'table' &&
        r.materialization.kind === 'session' &&
        r.materialization.engineEpoch !== this.sql.epoch,
    );
    if (stale.length)
      this.deps.edit((d) => {
        for (const r of stale)
          d.results[r.id]!.materialization = {kind: 'unavailable', reason: 'runtime-reset'};
      });
  }
  private table(id: ResultId) {
    const result = this.deps.document().results[id];
    if (!result || result.kind !== 'table')
      throw new AppFailure('REFERENCE_INVALID', 'Tabellenresultat fehlt.');
    return result;
  }
  async handle(id: ResultId, signal: AbortSignal): Promise<TableHandle> {
    const result = this.table(id);
    const cached = this.results.get(id);
    if (cached?.engineEpoch === this.sql.epoch) return cached;
    if (
      result.materialization.kind === 'unavailable' &&
      ['missing-artifact', 'recipe-import'].includes(result.materialization.reason)
    )
      throw new AppFailure('ARTIFACT_MISSING', 'Die gespeicherten Resultatdaten fehlen.');
    if (result.materialization.kind !== 'artifact')
      throw new AppFailure('RUNTIME_RESET', 'Nicht mehr in dieser Sitzung verfügbar.');
    const existing = this.restoring.get(id);
    if (existing) return existing;
    const artifact = this.deps.document().artifacts[result.materialization.artifactId]!;
    const job = (async () => {
      const handle = await this.sql.restore(
        await this.deps.artifacts.read(artifact, signal),
        result.schema,
        result.rowCount,
        signal,
      );
      this.results.set(id, handle);
      return handle;
    })();
    this.restoring.set(id, job);
    try {
      return await job;
    } finally {
      this.restoring.delete(id);
    }
  }
  async page(id: ResultId, request: PageRequest, signal: AbortSignal) {
    return this.sql.readPage(await this.handle(id, signal), request, signal);
  }
  async payload(id: ResultId, signal: AbortSignal) {
    const result = this.table(id);
    if (BigInt(result.rowCount) > 100000n)
      throw new AppFailure('LIMIT_EXCEEDED', 'R-Transfer erlaubt höchstens 100000 Zeilen.');
    fromTextRows(result.schema, []);
    const rows: unknown[][] = [];
    let bytes = 0;
    for (let offset = 0; offset < Number(result.rowCount); offset += 500) {
      const page = await this.page(id, {offset, size: 500, sort: []}, signal);
      for (const row of page.rows) {
        bytes += row.reduce<number>(
          (sum, v) => sum + new TextEncoder().encode(String(v ?? '')).byteLength + 8,
          0,
        );
        if (bytes > this.deps.budget.maxTransferBytes)
          throw new AppFailure('LIMIT_EXCEEDED', 'R-Transfer überschreitet Bytebudget.');
        rows.push([...row]);
      }
    }
    const payload = fromTextRows(result.schema, rows);
    if (payloadBytes(payload) > this.deps.budget.maxTransferBytes)
      throw new AppFailure('LIMIT_EXCEEDED', 'R-Transfer überschreitet Bytebudget.');
    return payload;
  }
  async export(id: ResultId, format: 'csv' | 'parquet', signal: AbortSignal) {
    return this.sql.exportFile(await this.handle(id, signal), format, signal);
  }
  async keepWithinJob(id: ResultId, signal: AbortSignal) {
    if (this.table(id).materialization.kind === 'artifact') return;
    const stream = await this.sql.snapshotParquet(await this.handle(id, signal), signal);
    const artifact = await this.deps.artifacts.write(
      this.deps.document().workspace.id,
      stream,
      'application/vnd.apache.parquet',
      signal,
    );
    signal.throwIfAborted();
    await this.deps.publish((d) => {
      d.artifacts[artifact.id] = artifact;
      const r = d.results[id]!;
      r.retention = 'kept';
      r.materialization = {kind: 'artifact', artifactId: artifact.id};
    });
  }
  keep(id: ResultId) {
    this.deps.assertWriter();
    return this.deps.scheduler.run('Resultat aufbewahren', new AbortController().signal, (signal) =>
      this.keepWithinJob(id, signal),
    );
  }
  saveVisualization(id: ResultId, name: string, spec: Visualization['spec']) {
    this.deps.assertWriter();
    return this.deps.scheduler.run(
      'Diagramm speichern',
      new AbortController().signal,
      async (signal) => {
        await this.chartData(id, spec, signal);
        await this.keepWithinJob(id, signal);
        const key = this.deps.newId<'visualization'>();
        await this.deps.publish((d) => {
          d.visualizations[key] = {
            id: key,
            workspaceId: d.workspace.id,
            name: nameSchema.parse(name),
            tableResultId: id,
            spec,
          };
        });
        return key;
      },
    );
  }
  async chartData(id: ResultId, spec: Visualization['spec'], signal: AbortSignal) {
    const table = this.table(id);
    if (BigInt(table.rowCount) > 5000n)
      throw new AppFailure(
        'LIMIT_EXCEEDED',
        'Diagramme erlauben höchstens 5000 Punkte. Bitte in SQL filtern oder aggregieren.',
      );
    if (
      ![spec.x, spec.y, ...(spec.color ? [spec.color] : [])].every((name) =>
        table.schema.columns.some((col) => col.name === name),
      )
    )
      throw new AppFailure('VALIDATION_FAILED', 'Diagrammspalte fehlt.');
    const rows: unknown[][] = [];
    for (let offset = 0; offset < Number(table.rowCount); offset += 500) {
      const page = await this.page(
        id,
        {offset, size: 500, sort: spec.type === 'line' ? [{column: spec.x, direction: 'asc'}] : []},
        signal,
      );
      rows.push(...page.rows.map((row) => [...row]));
    }
    const category = table.schema.columns.findIndex(
      (col) => col.name === (spec.color ?? (spec.type === 'bar' ? spec.x : '')),
    );
    if (category >= 0 && new Set(rows.map((row) => row[category])).size > 100)
      throw new AppFailure(
        'LIMIT_EXCEEDED',
        'Diagramme erlauben höchstens 100 Kategorien. Bitte in SQL aggregieren.',
      );
    return {schema: table.schema, rows};
  }
  asDataset(id: ResultId, name: string, sqlName: string): Promise<DatasetId> {
    this.deps.assertWriter();
    nameSchema.parse(name);
    sqlNameSchema.parse(sqlName);
    return this.deps.scheduler.run(
      'Resultat als Datensatz übernehmen',
      new AbortController().signal,
      async (signal) => {
        if (Object.values(this.deps.document().datasets).some((d) => d.sqlName === sqlName))
          throw new AppFailure('VALIDATION_FAILED', 'SQL-Name bereits reserviert.');
        await this.keepWithinJob(id, signal);
        const result = this.table(id);
        const artifact = await this.deps.artifacts.write(
          result.workspaceId,
          await this.export(id, 'parquet', signal),
          'application/vnd.apache.parquet',
          signal,
        );
        const datasetId = this.deps.newId<'dataset'>();
        const versionId = this.deps.newId<'dataset-version'>();
        const now = this.deps.now();
        signal.throwIfAborted();
        await this.deps.publish((d) => {
          if (Object.values(d.datasets).some((ds) => ds.sqlName === sqlName))
            throw new AppFailure('VALIDATION_FAILED', 'SQL-Name bereits reserviert.');
          d.artifacts[artifact.id] = artifact;
          d.datasets[datasetId] = {
            id: datasetId,
            workspaceId: d.workspace.id,
            name,
            sqlName,
            currentVersionId: versionId,
            createdAt: now,
          };
          d.datasetVersions[versionId] = {
            id: versionId,
            workspaceId: d.workspace.id,
            datasetId,
            schema: result.schema,
            rowCount: result.rowCount,
            createdAt: now,
            origin: {kind: 'result', resultId: id},
            backing: {kind: 'artifact', artifactId: artifact.id},
            evidence: {kind: 'sha256', value: artifact.sha256},
          };
        });
        return datasetId;
      },
    );
  }
  async close() {
    this.cancel('workspace-close');
    await this.deps.scheduler.close();
    this.results.clear();
  }
}
