import type {
  AnalysisId,
  DatasetId,
  ExecutionRun,
  ExecutionSnapshot,
  Id,
  RAnalysis,
  ResultId,
  RunId,
  WorkspaceDocument,
  PlotResult,
  ResolvedTableInput,
  TableResult,
} from '../domain/model';
import type {
  ColumnarPayload,
  RObjectRef,
  RObjectSummary,
  RScope,
  TransferPlan,
  ConversionIssue,
  TableHandle,
  ArtifactStore,
  TableTransferService,
} from './ports';
import type {ManagedREngine, RLimits} from './rPorts';
import type {AnalysisService} from './analysisService';
import type {ResultSqlEngine} from './sqlPorts';
import type {WorkspaceScheduler} from './scheduler';
import {AppFailure} from './errors';
import {transitionRun} from '../domain/run';
import {bindingNameSchema, nameSchema, sqlNameSchema, suggestSqlName} from '../domain/workspace';
import {fromTextRows, payloadBytes, validatePayload} from './rTypeCodec';
interface Dependencies {
  sessionId: string;
  document(): WorkspaceDocument;
  assertWriter(): void;
  edit(change: (d: WorkspaceDocument) => void): void;
  publish(change: (d: WorkspaceDocument) => void): Promise<void>;
  flush(): Promise<void>;
  r: ManagedREngine;
  sql: ResultSqlEngine;
  analyses: AnalysisService;
  artifacts: ArtifactStore;
  scheduler: WorkspaceScheduler;
  limits: RLimits;
  source(
    version: import('../domain/model').DatasetVersion,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
  encodePlot(image: ImageBitmap): Promise<Blob>;
  now(): string;
  newId: <K extends string>() => Id<K>;
}
interface PlanState {
  plan: TransferPlan;
  payload: ColumnarPayload;
  epoch: number;
  mutation: number;
  scope: RScope;
  analysisId?: AnalysisId;
  revision?: number;
  name?: string;
  resultId?: ResultId;
  object?: RObjectRef;
}
export interface ConsoleLine {
  kind: 'stdout' | 'stderr' | 'warning' | 'message';
  text: string;
}
export class RService implements TableTransferService {
  private plans = new Map<string, PlanState>();
  private scopes = new Map<AnalysisId, RScope>();
  private runScopes = new Map<RunId, RScope>();
  private history: RScope[] = [];
  private selectedScope: RScope | undefined;
  private logs = new Map<RunId, ConsoleLine[]>();
  private plots = new Map<ResultId, Blob>();
  private objects: RObjectSummary[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private active: RunId | undefined;
  private stopReason: ExecutionRun['stopReason'];
  constructor(private readonly deps: Dependencies) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.version;
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
  console(id: RunId) {
    return this.logs.get(id) ?? [];
  }
  get objectList() {
    return this.objects;
  }
  get scope() {
    return this.selectedScope;
  }
  get epoch() {
    return this.deps.r.epoch;
  }
  private analysis(id: AnalysisId): RAnalysis {
    const a = this.deps.document().analyses[id];
    if (!a || a.kind !== 'r' || a.archivedAt)
      throw new AppFailure('REFERENCE_INVALID', 'R-Analyse fehlt.');
    return a;
  }
  private async scopeFor(a: RAnalysis, signal: AbortSignal, fresh = false) {
    await this.deps.r.initialize(signal);
    const previous = this.scopes.get(a.id);
    if (
      previous?.engineEpoch === this.epoch &&
      (!fresh || a.environmentMode === 'workspace-session')
    )
      return previous;
    const scope = await this.deps.r.createScope(a.environmentMode);
    this.scopes.set(a.id, scope);
    if (a.environmentMode === 'fresh-environment') this.history.push(scope);
    return scope;
  }
  activate(id: AnalysisId) {
    this.deps.assertWriter();
    return this.deps.scheduler.run(
      'R initialisieren',
      new AbortController().signal,
      async (signal) => {
        this.selectedScope = await this.scopeFor(this.analysis(id), signal);
        await this.refreshObjects();
        return this.selectedScope;
      },
    );
  }
  private async refreshObjects() {
    this.objects =
      this.selectedScope?.engineEpoch === this.epoch
        ? await this.deps.r.listObjects(this.selectedScope)
        : [];
    this.emit();
  }
  selectRun(id: RunId) {
    return this.deps.scheduler.run('R Lauf auswählen', new AbortController().signal, async () => {
      this.selectedScope = this.runScopes.get(id);
      await this.refreshObjects();
      await this.prune();
    });
  }
  private async prune() {
    const inactive = this.history.filter(
      (s) => s !== this.selectedScope && ![...this.plans.values()].some((p) => p.scope === s),
    );
    while (inactive.length > 5) {
      const old = inactive.shift()!;
      await this.deps.r.releaseScope(old);
      this.history = this.history.filter((s) => s !== old);
      for (const [id, s] of this.scopes) if (s === old) this.scopes.delete(id);
      for (const [id, s] of this.runScopes) if (s === old) this.runScopes.delete(id);
    }
  }
  private invalidate() {
    this.scopes.clear();
    this.runScopes.clear();
    this.history = [];
    this.selectedScope = undefined;
    this.objects = [];
    this.plans.clear();
    this.plots.clear();
    this.deps.edit((d) => {
      for (const r of Object.values(d.results))
        if (r.kind === 'plot' && r.materialization.kind === 'session')
          r.materialization = {kind: 'unavailable', reason: 'runtime-reset'};
    });
    this.emit();
  }
  reset() {
    this.deps.assertWriter();
    return this.deps.scheduler.run('R zurücksetzen', new AbortController().signal, async () => {
      await this.deps.r.reset();
      this.invalidate();
      await this.deps.flush();
    });
  }
  cancel(reason: 'user' | 'workspace-close' = 'user') {
    if (this.active || this.deps.scheduler.getSnapshot()?.startsWith('R ')) {
      this.stopReason = reason;
      this.deps.scheduler.cancel();
    }
  }
  private async inputPayload(input: ResolvedTableInput, signal: AbortSignal) {
    if (input.kind === 'result') return this.deps.analyses.payload(input.resultId, signal);
    const version = this.deps.document().datasetVersions[input.versionId];
    if (!version || !version.rowCount)
      throw new AppFailure(
        'SOURCE_UNAVAILABLE',
        'Eingabeversion fehlt oder hat keinen geprüften Umfang.',
      );
    const handle = await this.deps.sql.captureParquet(
      await this.deps.source(version, signal),
      version.schema,
      version.rowCount,
      signal,
    );
    try {
      const rows: unknown[][] = [];
      for (let offset = 0; offset < Number(handle.rowCount); offset += 500) {
        const page = await this.deps.sql.readPage(handle, {offset, size: 500, sort: []}, signal);
        rows.push(...page.rows.map((r) => [...r]));
      }
      const payload = fromTextRows(handle.schema, rows);
      validatePayload(payload, this.deps.limits.hardRows, this.deps.limits.transferBytes);
      return payload;
    } finally {
      await this.deps.sql.release(handle);
    }
  }
  run(id: AnalysisId, selection?: string) {
    this.deps.assertWriter();
    const a = structuredClone(this.analysis(id));
    this.plans.clear();
    const doc = structuredClone(this.deps.document());
    return this.deps.scheduler.run('R ausführen', new AbortController().signal, async (signal) => {
      const scope = await this.scopeFor(a, signal, true);
      this.selectedScope = scope;
      const inputs: ResolvedTableInput[] = a.inputs.map((i) =>
        i.source.kind === 'result'
          ? {kind: 'result', resultId: i.source.resultId, bindingName: i.name, usage: 'bound'}
          : {
              kind: 'dataset-version',
              datasetId: i.source.datasetId,
              versionId: i.source.versionId ?? doc.datasets[i.source.datasetId]!.currentVersionId,
              bindingName: i.name,
              usage: 'bound',
            },
      );
      const snapshot: ExecutionSnapshot = {
        analysisId: id,
        analysisRevision: a.revision,
        language: 'r',
        code: selection ?? a.code,
        parameters: a.parameters,
        resolvedInputs: inputs,
        inputScope: 'explicit-bindings',
        runtime: await this.deps.r.fingerprint(),
        environmentMode: a.environmentMode,
        ...(a.randomSeed === undefined ? {} : {randomSeed: a.randomSeed}),
        provenance:
          a.environmentMode === 'workspace-session' ? 'session-dependent' : 'declared-inputs',
        notes: [
          ...(selection ? ['Ausdrücklich markierte Auswahl ausgeführt.'] : []),
          'Fresh-Environment ist keine Prozessisolation.',
        ],
      };
      const runId = this.deps.newId<'run'>(),
        started = this.deps.now(),
        start = Date.now();
      const run: ExecutionRun = {
        id: runId,
        workspaceId: doc.workspace.id,
        trigger: 'analysis',
        snapshot,
        status: 'queued',
        queuedAt: started,
        warnings: [],
        resultIds: [],
      };
      await this.deps.publish((d) => {
        d.runs[runId] = run;
      });
      this.active = runId;
      this.stopReason = undefined;
      this.runScopes.set(runId, scope);
      this.logs.set(runId, []);
      this.deps.edit((d) => {
        transitionRun(d.runs[runId]!, 'running');
        d.runs[runId]!.startedAt = started;
      });
      const timeout = new AbortController(),
        joined = AbortSignal.any([signal, timeout.signal]);
      const timer = setTimeout(() => {
        this.stopReason = 'timeout';
        timeout.abort();
      }, this.deps.limits.timeoutMs);
      const cancelling = () => {
        if (this.deps.document().runs[runId]?.status === 'running')
          this.deps.edit((d) => transitionRun(d.runs[runId]!, 'cancelling'));
      };
      joined.addEventListener('abort', cancelling, {once: true});
      const pictures: {id: ResultId; image: ImageBitmap}[] = [];
      const warnings: string[] = [];
      let lines = 0,
        bytes = 0,
        logLimited = false;
      try {
        for (const input of inputs)
          await this.deps.r.bindDataFrame(
            scope,
            input.bindingName,
            await this.inputPayload(input, joined),
            joined,
          );
        await this.deps.r.evaluate(
          scope,
          runId,
          snapshot,
          (event) => {
            if (event.kind === 'plot') {
              if (pictures.length < 10)
                pictures.push({id: this.deps.newId<'result'>(), image: event.image});
              else {
                event.image.close();
                if (!warnings.includes('Maximal zehn Plotbilder pro Lauf.'))
                  warnings.push('Maximal zehn Plotbilder pro Lauf.');
              }
              return;
            }
            const log = this.logs.get(runId)!;
            for (const text of event.text.split('\n')) {
              const size = new TextEncoder().encode(text).byteLength;
              if (lines >= 2000 || bytes + size > 1048576) {
                if (!logLimited) {
                  warnings.push('Konsole auf 2000 Zeilen / 1 MiB begrenzt.');
                  logLimited = true;
                }
                break;
              }
              lines++;
              bytes += size;
              log.push({kind: event.kind, text});
            }
            this.emit();
          },
          joined,
        );
        joined.throwIfAborted();
        const results: PlotResult[] = [];
        for (const {id: resultId, image} of pictures) {
          const blob = await this.deps.encodePlot(image);
          this.plots.set(resultId, blob);
          results.push({
            id: resultId,
            workspaceId: doc.workspace.id,
            runId,
            kind: 'plot',
            name: `${a.name} · Grafik ${results.length + 1}`,
            createdAt: this.deps.now(),
            retention: 'temporary',
            materialization: {
              kind: 'session',
              sessionId: this.deps.sessionId,
              engineEpoch: this.epoch,
            },
            mediaType: 'image/png',
            width: image.width,
            height: image.height,
          });
        }
        joined.throwIfAborted();
        clearTimeout(timer);
        joined.removeEventListener('abort', cancelling);
        this.active = undefined;
        const finished = this.deps.now(),
          duration = Date.now() - start;
        await this.deps.publish((d) => {
          const r = d.runs[runId]!;
          transitionRun(r, 'succeeded');
          r.finishedAt = finished;
          r.durationMs = duration;
          r.warnings = warnings;
          r.resultIds = results.map((r) => r.id);
          for (const result of results) d.results[result.id] = result;
        });
      } catch (error) {
        for (const picture of pictures) this.plots.delete(picture.id);
        const cancelled = joined.aborted;
        this.deps.edit((d) => {
          const r = d.runs[runId]!;
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
                : 'R_ERROR',
            message: error instanceof Error ? error.message : String(error),
          };
          r.warnings = [
            ...warnings,
            ...(scope.engineEpoch !== this.epoch
              ? [
                  'R-Worker beendet: ungesicherte Sitzungsobjekte und temporäre Grafiken sind verloren.',
                ]
              : []),
          ];
        });
        if (scope.engineEpoch !== this.epoch) this.invalidate();
      } finally {
        clearTimeout(timer);
        joined.removeEventListener('abort', cancelling);
        this.active = undefined;
        for (const picture of pictures) picture.image.close();
        await this.deps.flush();
        await this.refreshObjects();
        await this.prune();
      }
      return runId;
    });
  }
  async plot(id: ResultId, signal: AbortSignal) {
    const current = this.plots.get(id);
    if (current) return current;
    const result = this.deps.document().results[id];
    if (result?.kind !== 'plot' || result.materialization.kind !== 'artifact')
      throw new AppFailure('ARTIFACT_MISSING', 'Grafik nicht mehr verfügbar.');
    return new Response(
      await this.deps.artifacts.read(
        this.deps.document().artifacts[result.materialization.artifactId]!,
        signal,
      ),
    ).blob();
  }
  keepPlot(id: ResultId) {
    this.deps.assertWriter();
    return this.deps.scheduler.run(
      'R Grafik aufbewahren',
      new AbortController().signal,
      async (signal) => {
        const blob = await this.plot(id, signal);
        const artifact = await this.deps.artifacts.write(
          this.deps.document().workspace.id,
          blob.stream(),
          'image/png',
          signal,
        );
        await this.deps.publish((d) => {
          d.artifacts[artifact.id] = artifact;
          d.results[id]!.retention = 'kept';
          d.results[id]!.materialization = {kind: 'artifact', artifactId: artifact.id};
        });
      },
    );
  }
  private plan(payload: ColumnarPayload, scope: RScope, extra: ConversionIssue[] = []) {
    validatePayload(payload, this.deps.limits.hardRows, this.deps.limits.transferBytes);
    const issues = [...payload.issues, ...extra];
    if (payload.rowCount > this.deps.limits.warningRows)
      issues.push({
        id: 'row-warning',
        column: '*',
        kind: 'representation-change',
        message: `${payload.rowCount} Zeilen: mehrere WASM-Kopien sind möglich.`,
        requiresApproval: true,
      });
    return {
      id: crypto.randomUUID(),
      rowCount: String(payload.rowCount),
      estimatedBytes: payloadBytes(payload),
      requiresApproval: issues.some((i) => i.requiresApproval),
      issues,
      scope,
    };
  }
  planToR(resultId: ResultId, analysisId: AnalysisId, variableName: string, signal: AbortSignal) {
    this.deps.assertWriter();
    bindingNameSchema.parse(variableName);
    return this.deps.scheduler.run('R Transfer planen', signal, async (joined) => {
      const a = this.analysis(analysisId),
        scope = await this.scopeFor(a, joined),
        payload = await this.deps.analyses.payload(resultId, joined);
      const collision =
        (await this.deps.r.listObjects(scope)).some((o) => o.ref.name === variableName) ||
        a.inputs.some((i) => i.name === variableName);
      const result = this.deps.document().results[resultId];
      const extra: ConversionIssue[] = collision
        ? [
            {
              id: 'replace-variable',
              column: variableName,
              kind: 'representation-change',
              message: `Vorhandene Variable ${variableName} ausdrücklich ersetzen.`,
              requiresApproval: true,
            },
          ]
        : [];
      if (result?.kind === 'table' && result.coverage.kind === 'limited')
        extra.push({
          id: 'limited-source',
          column: '*',
          kind: 'representation-change',
          message:
            'Das SQL-Resultat ist bereits begrenzt. Alle darin enthaltenen Zeilen werden übertragen.',
          requiresApproval: true,
        });
      const plan = this.plan(payload, scope, extra);
      this.plans.clear();
      this.plans.set(plan.id, {
        plan,
        payload,
        scope,
        analysisId,
        revision: a.revision,
        name: variableName,
        resultId,
        epoch: this.epoch,
        mutation: this.deps.r.mutation,
      });
      return plan;
    });
  }
  private requirePlan(id: string, approved: string[]) {
    const p = this.plans.get(id);
    if (!p || p.epoch !== this.epoch || p.mutation !== this.deps.r.mutation)
      throw new AppFailure('RUNTIME_RESET', 'Transferplan veraltet. Bitte neu planen.');
    if (
      p.analysisId &&
      (this.analysis(p.analysisId).revision !== p.revision ||
        this.scopes.get(p.analysisId)?.key !== p.scope.key)
    )
      throw new AppFailure('REVISION_CONFLICT', 'Analyse/Scope seit Planung geändert.');
    if (p.plan.issues.some((i) => i.requiresApproval && !approved.includes(i.id)))
      throw new AppFailure(
        'CONVERSION_APPROVAL_REQUIRED',
        'Offene Warnungen/Ersetzungen bestätigen.',
      );
    return p;
  }
  commitToR(id: string, approved: string[], signal: AbortSignal) {
    this.deps.assertWriter();
    return this.deps.scheduler.run('R Transfer übernehmen', signal, async (joined) => {
      const p = this.requirePlan(id, approved);
      if (!p.analysisId || !p.resultId || !p.name)
        throw new AppFailure('REFERENCE_INVALID', 'Falscher Transferplan.');
      await this.deps.analyses.keepWithinJob(p.resultId, joined);
      this.requirePlan(id, approved);
      joined.throwIfAborted();
      await this.deps.r.bindDataFrame(p.scope, p.name, p.payload, joined);
      const now = this.deps.now();
      try {
        await this.deps.publish((d) => {
          const a = d.analyses[p.analysisId!]!;
          if (a.revision !== p.revision)
            throw new AppFailure('REVISION_CONFLICT', 'Analyse geändert.');
          a.inputs = a.inputs.filter((i) => i.name !== p.name);
          a.inputs.push({name: p.name!, source: {kind: 'result', resultId: p.resultId!}});
          a.revision++;
          a.updatedAt = now;
        });
      } catch (e) {
        await this.deps.r.reset();
        this.invalidate();
        throw e;
      }
      this.plans.delete(id);
      this.selectedScope = p.scope;
      await this.refreshObjects();
    });
  }
  previewObject(ref: RObjectRef, signal: AbortSignal) {
    this.deps.assertWriter();
    return this.deps.scheduler.run('R Objekt ansehen', signal, async (joined) => {
      const payload = await this.deps.r.readDataFrame(ref, joined);
      return {
        schema: payload.schema,
        rows: Array.from({length: Math.min(200, payload.rowCount)}, (_, i) =>
          payload.columns.map((c) => (c.validity[i] ? String(c.values[i]) : null)),
        ),
      };
    });
  }
  planFromR(ref: RObjectRef, signal: AbortSignal) {
    this.deps.assertWriter();
    return this.deps.scheduler.run('R Objekt planen', signal, async (joined) => {
      const payload = await this.deps.r.readDataFrame(ref, joined),
        plan = this.plan(payload, ref.scope);
      this.plans.clear();
      this.plans.set(plan.id, {
        plan,
        payload,
        scope: ref.scope,
        object: ref,
        epoch: this.epoch,
        mutation: this.deps.r.mutation,
      });
      return plan;
    });
  }
  commitFromR(
    id: string,
    name: string,
    approved: string[],
    signal: AbortSignal,
    options?: {sqlName?: string; replace?: DatasetId},
  ) {
    this.deps.assertWriter();
    return this.deps.scheduler.run('R Objekt übernehmen', signal, async (joined) => {
      const p = this.requirePlan(id, approved);
      if (!p.object) throw new AppFailure('REFERENCE_INVALID', 'Falscher Transferplan.');
      nameSchema.parse(name);
      const doc = this.deps.document(),
        existing = options?.replace ? doc.datasets[options.replace] : undefined;
      if (options?.replace && (!existing || existing.removedAt))
        throw new AppFailure('REFERENCE_INVALID', 'Zieldatensatz fehlt.');
      const sqlName = sqlNameSchema.parse(
        existing?.sqlName ??
          options?.sqlName ??
          suggestSqlName(
            name,
            Object.values(doc.datasets).map((d) => d.sqlName),
          ),
      );
      if (Object.values(doc.datasets).some((d) => d.id !== existing?.id && d.sqlName === sqlName))
        throw new AppFailure('VALIDATION_FAILED', 'SQL-Name bereits reserviert.');
      const handle: TableHandle = await this.deps.sql.importColumnar(p.payload, joined);
      try {
        const internal = await this.deps.artifacts.write(
          doc.workspace.id,
          await this.deps.sql.snapshotParquet(handle, joined),
          'application/vnd.apache.parquet',
          joined,
        );
        const data = await this.deps.artifacts.write(
          doc.workspace.id,
          await this.deps.sql.exportFile(handle, 'parquet', joined),
          'application/vnd.apache.parquet',
          joined,
        );
        this.requirePlan(id, approved);
        joined.throwIfAborted();
        const resultId = this.deps.newId<'result'>(),
          runId = this.deps.newId<'run'>(),
          datasetId = existing?.id ?? this.deps.newId<'dataset'>(),
          versionId = this.deps.newId<'dataset-version'>(),
          now = this.deps.now();
        const snapshot: ExecutionSnapshot = {
          language: 'r',
          code: '',
          parameters: {},
          resolvedInputs: [],
          inputScope: 'session-capture',
          runtime: await this.deps.r.fingerprint(),
          provenance: 'session-dependent',
          notes: [
            `Aktueller Dataframe ${p.object.name}; Scope ${p.scope.key}, R-Epoche ${p.scope.engineEpoch}. Keine Skriptwiederholung.`,
          ],
        };
        const result: TableResult = {
          id: resultId,
          workspaceId: doc.workspace.id,
          runId,
          kind: 'table',
          name,
          createdAt: now,
          retention: 'kept',
          materialization: {kind: 'artifact', artifactId: internal.id},
          schema: p.payload.schema,
          rowCount: String(p.payload.rowCount),
          coverage: {kind: 'complete'},
        };
        await this.deps.publish((d) => {
          if (existing && d.datasets[datasetId]?.currentVersionId !== existing.currentVersionId)
            throw new AppFailure('REVISION_CONFLICT', 'Zieldatensatz inzwischen geändert.');
          d.artifacts[internal.id] = internal;
          d.artifacts[data.id] = data;
          d.runs[runId] = {
            id: runId,
            workspaceId: doc.workspace.id,
            trigger: 'r-object-capture',
            snapshot,
            status: 'succeeded',
            queuedAt: now,
            startedAt: now,
            finishedAt: now,
            warnings: p.payload.issues.map((i) => i.message),
            resultIds: [resultId],
          };
          d.results[resultId] = result;
          d.datasets[datasetId] = {
            id: datasetId,
            workspaceId: doc.workspace.id,
            name,
            sqlName,
            currentVersionId: versionId,
            createdAt: existing?.createdAt ?? now,
          };
          d.datasetVersions[versionId] = {
            id: versionId,
            workspaceId: doc.workspace.id,
            datasetId,
            origin: {kind: 'result', resultId},
            backing: {kind: 'artifact', artifactId: data.id},
            evidence: {kind: 'sha256', value: data.sha256},
            schema: p.payload.schema,
            rowCount: String(p.payload.rowCount),
            createdAt: now,
          };
        });
        this.plans.delete(id);
      } finally {
        await this.deps.sql.release(handle);
      }
    });
  }
  async close() {
    this.cancel('workspace-close');
    await this.deps.scheduler.close();
    await this.deps.r.dispose();
    this.plans.clear();
    this.plots.clear();
    this.logs.clear();
    this.scopes.clear();
    this.runScopes.clear();
    this.objects = [];
    this.emit();
  }
}
