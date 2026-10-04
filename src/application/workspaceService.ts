import {measure} from './diagnostics';
import {WorkspaceArchive} from './workspaceArchive';
import {RecoveryService} from './recoveryService';
import type {ArchiveCodec} from './archivePorts';
import type {ArtifactReferenceCheck} from './ports';
import {RService} from './rService';
import type {ManagedREngine, RLimits} from './rPorts';
import type {Analysis, AnalysisId, WorkspaceId, WorkspaceDocument, Id} from '../domain/model';
import {checkedId, emptyWorkspace, nameSchema, parseWorkspace} from '../domain/workspace';
import type {WorkspaceRepository, WorkspaceLock, WorkspaceLease} from './ports';
import {PersistenceCoordinator} from './persistenceCoordinator';
import {AppFailure} from './errors';
import {DatasetService} from './datasetService';
import type {ManagedArtifactStore} from './storagePorts';
import type {FileImportEngine} from './importPorts';
import type {ResultSqlEngine} from './sqlPorts';
import type {ExecutionBudget} from './ports';
import {AnalysisService} from './analysisService';
import {WorkspaceScheduler} from './scheduler';
interface Dependencies {
  repository: WorkspaceRepository;
  archiveCodec?: ArchiveCodec;
  mode?: 'persistent' | 'temporary';
  canCreate?: boolean;
  artifacts?: ManagedArtifactStore;
  publicSource?: import('./catalogPorts').PublicSource;
  createImportEngine?: () => FileImportEngine;
  createEngines?: (
    sessionId: string,
    source: (
      version: import('../domain/model').DatasetVersion,
      signal: AbortSignal,
    ) => Promise<ReadableStream<Uint8Array>>,
  ) => {files: FileImportEngine; sql: ResultSqlEngine};
  budget?: ExecutionBudget;
  createR?: (sessionId: string) => ManagedREngine;
  rLimits?: RLimits;
  encodePlot?: (image: ImageBitmap) => Promise<Blob>;
  lock: WorkspaceLock;
  newId: <K extends string>() => Id<K>;
  now: () => string;
}
export class WorkspaceEditingSession {
  readonly persistence: PersistenceCoordinator;
  readonly sessionId: string;
  private closed = false;
  private datasets: DatasetService | undefined;
  private analyses: AnalysisService | undefined;
  private r: RService | undefined;
  private engines: {files: FileImportEngine; sql: ResultSqlEngine} | undefined;
  readonly scheduler = new WorkspaceScheduler();
  integrity: ArtifactReferenceCheck | undefined;
  hashesChecked = false;
  integrityError: string | undefined;
  constructor(
    document: WorkspaceDocument,
    readonly lease: WorkspaceLease,
    private readonly deps: Dependencies,
    missingArtifacts: readonly string[] = [],
  ) {
    this.persistence = new PersistenceCoordinator(document, deps.repository);
    this.sessionId = deps.newId();
    const recover = (d: WorkspaceDocument) => {
      for (const r of Object.values(d.runs))
        if (['queued', 'running', 'cancelling'].includes(r.status)) {
          r.status = 'interrupted';
          r.stopReason = 'runtime-crash';
          r.finishedAt = deps.now();
        }
      for (const r of Object.values(d.results))
        if (r.materialization.kind === 'session')
          r.materialization = {kind: 'unavailable', reason: 'session-ended'};
        else if (
          r.materialization.kind === 'artifact' &&
          missingArtifacts.includes(r.materialization.artifactId)
        )
          r.materialization = {kind: 'unavailable', reason: 'missing-artifact'};
    };
    if (
      Object.values(document.runs).some((r) =>
        ['queued', 'running', 'cancelling'].includes(r.status),
      ) ||
      Object.values(document.results).some(
        (r) =>
          r.materialization.kind === 'session' ||
          (r.materialization.kind === 'artifact' &&
            missingArtifacts.includes(r.materialization.artifactId)),
      )
    ) {
      if (this.readOnly) {
        const recovered = structuredClone(document);
        recover(recovered);
        this.persistence.document = parseWorkspace(recovered);
      } else this.persistence.mutate(recover);
    }
  }
  async inspectIntegrity(signal: AbortSignal, hashes = false) {
    if (!this.deps.artifacts) return;
    return this.scheduler.run('Dateien prüfen', signal, async (joined) => {
      const report = await new RecoveryService(this.deps.artifacts!).inspect(
        this.document,
        joined,
        hashes,
      );
      this.integrity = report;
      this.hashesChecked = hashes;
      return report;
    });
  }
  async exportArchive(
    mode: 'recipe' | 'with-data',
    options: {keepTemporary: boolean; includeExternal: boolean},
    signal: AbortSignal,
  ) {
    if (!this.deps.archiveCodec || !this.deps.artifacts)
      throw new AppFailure('CAPABILITY_UNAVAILABLE', 'Archivkonfiguration fehlt.');
    if (this.scheduler.getSnapshot())
      throw new AppFailure(
        'VALIDATION_FAILED',
        'Laufende Operation zuerst abschliessen oder abbrechen.',
      );
    if (mode === 'with-data' && options.keepTemporary) {
      this.assertWriter();
      for (const r of Object.values(this.document.results))
        if (r.materialization.kind === 'session') {
          signal.throwIfAborted();
          if (r.kind === 'table') await this.getAnalyses().keep(r.id);
          else await this.getR().keepPlot(r.id);
        }
    }
    return this.scheduler.run('Projekt exportieren', signal, async (joined) => {
      // Export also works for unsaved editor state after an autosave error; it never runs code.
      const archive = new WorkspaceArchive({
        ...this.deps,
        codec: this.deps.archiveCodec!,
        artifacts: this.deps.artifacts!,
      });
      return archive.export(this.document, mode, options.includeExternal, joined);
    });
  }
  get mode() {
    return this.deps.mode ?? 'persistent';
  }
  private ensureEngines() {
    if (!this.deps.createEngines || !this.deps.artifacts)
      throw new AppFailure('CAPABILITY_UNAVAILABLE', 'SQL-Engine fehlt.');
    return (this.engines ??= this.deps.createEngines(this.sessionId, (version, signal) =>
      this.source(version, signal),
    ));
  }
  private async source(version: import('../domain/model').DatasetVersion, signal: AbortSignal) {
    if (version.backing.kind === 'public-parquet' && this.deps.publicSource) {
      const source = await this.deps.publicSource.fetch(version.backing.url, signal, version);
      return new Blob([source.bytes]).stream();
    }
    if (version.backing.kind !== 'artifact')
      throw new AppFailure('SOURCE_UNAVAILABLE', 'Datenstand fehlt.');
    const artifact = this.document.artifacts[version.backing.artifactId];
    if (!artifact || !this.deps.artifacts)
      throw new AppFailure('ARTIFACT_MISSING', 'Dateimetadaten fehlen.');
    return this.deps.artifacts.read(artifact, signal);
  }
  getR() {
    if (!this.deps.createR || !this.deps.rLimits || !this.deps.encodePlot || !this.deps.artifacts)
      throw new AppFailure('CAPABILITY_UNAVAILABLE', 'R-Konfiguration fehlt.');
    return (this.r ??= new RService({
      sessionId: this.sessionId,
      document: () => this.document,
      assertWriter: () => this.assertWriter(),
      edit: (change) => this.edit(change),
      publish: (change) => this.persistence.publish(change),
      flush: this.flush,
      r: this.deps.createR(this.sessionId),
      sql: this.ensureEngines().sql,
      analyses: this.getAnalyses(),
      scheduler: this.scheduler,
      artifacts: this.deps.artifacts,
      limits: this.deps.rLimits,
      source: (version, signal) => this.source(version, signal),
      encodePlot: this.deps.encodePlot,
      now: this.deps.now,
      newId: this.deps.newId,
    }));
  }

  getAnalyses() {
    if (!this.deps.artifacts || !this.deps.budget)
      throw new AppFailure('CAPABILITY_UNAVAILABLE', 'SQL-Konfiguration fehlt.');
    return (this.analyses ??= new AnalysisService({
      sessionId: this.sessionId,
      document: () => this.document,
      edit: (change) => this.edit(change),
      publish: (change) => this.persistence.publish(change),
      flush: this.flush,
      assertWriter: () => this.assertWriter(),
      sql: this.ensureEngines().sql,
      scheduler: this.scheduler,
      artifacts: this.deps.artifacts,
      budget: this.deps.budget,
      newId: this.deps.newId,
      now: this.deps.now,
    }));
  }
  private assertWriter() {
    if (this.closed || this.readOnly)
      throw new AppFailure('READ_ONLY_WORKSPACE', 'Sitzung ist nicht schreibbar.');
  }
  getDatasets() {
    if (!this.deps.artifacts || (!this.deps.createImportEngine && !this.deps.createEngines))
      throw new AppFailure('CAPABILITY_UNAVAILABLE', 'Dateispeicher ist nicht verfügbar.');
    return (this.datasets ??= new DatasetService({
      document: () => this.document,
      assertWriter: () => {
        if (this.closed || this.readOnly)
          throw new AppFailure('READ_ONLY_WORKSPACE', 'Sitzung ist nicht schreibbar.');
      },
      publish: (change) => this.persistence.publish(change),
      flush: this.flush,
      ...(this.deps.publicSource ? {publicSource: this.deps.publicSource} : {}),
      engine: this.deps.createEngines
        ? this.ensureEngines().files
        : this.deps.createImportEngine!(),
      scheduler: this.scheduler,
      artifacts: this.deps.artifacts,
      newId: this.deps.newId,
      now: this.deps.now,
    }));
  }
  renameDataset(id: import('../domain/model').DatasetId, name: string) {
    this.edit((d) => {
      const dataset = d.datasets[id];
      if (dataset) dataset.name = nameSchema.parse(name);
    });
  }
  removeDataset(id: import('../domain/model').DatasetId) {
    this.edit((d) => {
      const dataset = d.datasets[id];
      if (dataset) dataset.removedAt = this.deps.now();
    });
  }
  get document() {
    return this.persistence.document;
  }
  get readOnly() {
    return this.lease.mode === 'reader';
  }
  edit(change: (document: WorkspaceDocument) => void) {
    if (this.closed) throw new AppFailure('RUNTIME_RESET', 'Die Sitzung ist geschlossen.');
    if (this.readOnly)
      throw new AppFailure(
        'READ_ONLY_WORKSPACE',
        'Dieses Projekt ist in einem anderen Tab geöffnet.',
      );
    this.persistence.mutate((d) => {
      change(d);
      d.workspace.updatedAt = this.deps.now();
    });
  }
  rename(name: string) {
    this.edit((d) => {
      d.workspace.name = nameSchema.parse(name);
    });
  }
  describe(description: string) {
    this.edit((d) => {
      d.workspace.description = description;
    });
  }
  createAnalysis(kind: 'sql' | 'r'): AnalysisId {
    const id = this.deps.newId<'analysis'>();
    const now = this.deps.now();
    const common = {
      id,
      workspaceId: this.document.workspace.id,
      name: kind === 'sql' ? 'Neue SQL-Abfrage' : 'Neues R-Skript',
      code: kind === 'sql' ? 'SELECT 1 AS wert;' : '# R-Code wird nur nach Ausführen gestartet.\n',
      revision: 0,
      inputs: [],
      parameters: {},
      createdAt: now,
      updatedAt: now,
    };
    const analysis: Analysis =
      kind === 'sql'
        ? {...common, kind, engineId: 'duckdb-local'}
        : {...common, kind, engineId: 'webr-local', environmentMode: 'workspace-session'};
    this.edit((d) => {
      d.analyses[id] = analysis;
    });
    return id;
  }
  updateAnalysis(
    id: AnalysisId,
    update: {
      name?: string;
      code?: string;
      parameters?: Analysis['parameters'];
      environmentMode?: 'workspace-session' | 'fresh-environment';
      randomSeed?: number | null;
    },
  ) {
    this.edit((d) => {
      const a = d.analyses[id];
      if (!a || a.archivedAt) throw new AppFailure('REFERENCE_INVALID', 'Analyse nicht gefunden.');
      if (update.name !== undefined) a.name = nameSchema.parse(update.name);
      if (update.code !== undefined && update.code !== a.code) {
        a.code = update.code;
        a.revision++;
      }
      if (update.parameters !== undefined) {
        a.parameters = structuredClone(update.parameters);
        a.revision++;
      }
      if (a.kind === 'r') {
        if (update.environmentMode !== undefined && update.environmentMode !== a.environmentMode) {
          a.environmentMode = update.environmentMode;
          a.revision++;
        }
        if (update.randomSeed !== undefined) {
          if (update.randomSeed === null) delete a.randomSeed;
          else a.randomSeed = update.randomSeed;
          a.revision++;
        }
      }
      a.updatedAt = this.deps.now();
    });
  }
  duplicateAnalysis(id: AnalysisId): AnalysisId {
    const nextId = this.deps.newId<'analysis'>();
    const now = this.deps.now();
    this.edit((d) => {
      const original = d.analyses[id];
      if (!original || original.archivedAt)
        throw new AppFailure('REFERENCE_INVALID', 'Analyse nicht gefunden.');
      d.analyses[nextId] = {
        ...structuredClone(original),
        id: nextId,
        name: `${original.name.slice(0, 112)} (Kopie)`,
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
    });
    return nextId;
  }
  archiveAnalysis(id: AnalysisId) {
    this.edit((d) => {
      const a = d.analyses[id];
      if (!a) throw new AppFailure('REFERENCE_INVALID', 'Analyse nicht gefunden.');
      a.archivedAt = this.deps.now();
    });
  }
  flush = () => this.persistence.flush();
  async close() {
    if (this.closed) return;
    await this.flush();
    await this.r?.close();
    await this.analyses?.close();
    await this.scheduler.close();
    await this.datasets?.close();
    await this.engines?.sql.dispose();
    await this.flush();
    this.persistence.stopTimers();
    await this.lease.release();
    this.closed = true;
  }
}
export class WorkspaceService {
  private active: WorkspaceEditingSession | undefined;
  private navigation: Promise<void> = Promise.resolve();
  private archive: WorkspaceArchive | undefined;
  constructor(private readonly deps: Dependencies) {}
  getArchive() {
    if (!this.deps.archiveCodec || !this.deps.artifacts)
      throw new AppFailure('CAPABILITY_UNAVAILABLE', 'Archivkonfiguration fehlt.');
    return (this.archive ??= new WorkspaceArchive({
      ...this.deps,
      codec: this.deps.archiveCodec,
      artifacts: this.deps.artifacts,
    }));
  }
  async importArchive(id: string, signal: AbortSignal) {
    if (!this.canCreate)
      throw new AppFailure('READ_ONLY_WORKSPACE', 'Persistenter Import braucht Web Locks.');
    return this.getArchive().commitImport(id, signal);
  }
  async duplicate(id: WorkspaceId, signal: AbortSignal) {
    if (!this.canCreate)
      throw new AppFailure('READ_ONLY_WORKSPACE', 'Duplizieren braucht Web Locks.');
    const session = await this.open(id);
    const exported = await session.exportArchive(
      'with-data',
      {keepTemporary: false, includeExternal: false},
      signal,
    );
    const candidate = await this.getArchive().inspect(exported.blob, signal);
    return this.getArchive().commitImport(
      candidate.id,
      signal,
      `${session.document.workspace.name.slice(0, 112)} (Kopie)`,
    );
  }
  async deleteWorkspace(id: WorkspaceId, expectedRevision: number) {
    return this.enqueue(async () => {
      let reviewedRevision = expectedRevision;
      if (this.active?.document.workspace.id === id) {
        if (this.active.readOnly)
          throw new AppFailure('READ_ONLY_WORKSPACE', 'Ein anderer Tab hält das Schreibrecht.');
        if (this.active.document.revision !== expectedRevision)
          throw new AppFailure('REVISION_CONFLICT', 'Projekt seit Bestätigung geändert.');
        await this.active.close();
        reviewedRevision = this.active.document.revision;
        this.active = undefined;
      }
      const lease = await this.deps.lock.acquire(id, new AbortController().signal);
      try {
        if (lease.mode !== 'writer')
          throw new AppFailure('READ_ONLY_WORKSPACE', 'Ein anderer Tab hält das Schreibrecht.');
        const doc = await this.deps.repository.load(id);
        if (!doc) throw new AppFailure('REFERENCE_INVALID', 'Projekt fehlt.');
        // Requiring the shown revision prevents deleting unreviewed changes from another tab.
        if (doc.revision !== reviewedRevision)
          throw new AppFailure(
            'REVISION_CONFLICT',
            'Projekt seit Bestätigung geändert. Bitte neu öffnen und prüfen.',
          );
        await this.deps.repository.remove(id, doc.revision);
        return this.deps.artifacts ? new RecoveryService(this.deps.artifacts).removeFiles(id) : [];
      } finally {
        await lease.release();
      }
    });
  }
  async cleanAbandoned(signal: AbortSignal) {
    if (!this.deps.artifacts)
      throw new AppFailure('CAPABILITY_UNAVAILABLE', 'Dateispeicher fehlt.');
    return new RecoveryService(this.deps.artifacts).cleanAbandoned(
      this.deps.repository,
      this.deps.lock,
      signal,
    );
  }
  async previewPortal(table: import('./catalogPorts').ResolvedCatalogTable, signal: AbortSignal) {
    // Unassigned import staging is owned here, never by a React panel. No workspace mutation.
    await this.close();
    if (!this.deps.publicSource || !this.deps.createEngines)
      throw new AppFailure('SOURCE_UNAVAILABLE', 'Portalzugriff fehlt.');
    const source = await this.deps.publicSource.fetch(table.publicParquetUrl, signal);
    const engines = this.deps.createEngines(this.deps.newId(), async () => {
      throw new AppFailure('SOURCE_UNAVAILABLE', 'Keine Workspacequelle im Import-Staging.');
    });
    try {
      const preview = await engines.files.preview(
        new File([source.bytes], `${table.tableId}.parquet`),
        'parquet',
        undefined,
        signal,
      );
      return {...preview, sourceSha256: source.sha256};
    } finally {
      await engines.files.dispose();
      await engines.sql.dispose();
    }
  }
  list() {
    return this.deps.repository.list();
  }
  get canCreate() {
    return this.deps.canCreate ?? true;
  }
  async create(name: string) {
    if (!this.canCreate)
      throw new AppFailure(
        'CAPABILITY_UNAVAILABLE',
        'Ohne Web Locks sind gespeicherte Projekte nur lesbar.',
      );
    const d = emptyWorkspace(this.deps.newId<'workspace'>(), name, this.deps.now());
    return this.deps.repository.create(d);
  }
  async open(rawId: string): Promise<WorkspaceEditingSession> {
    const id = checkedId<'workspace'>(rawId);
    return this.enqueue(async () => {
      if (this.active?.document.workspace.id === id) return this.active;
      return measure('Workspace öffnen', () => this.openNext(id));
    });
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.navigation.then(operation);
    this.navigation = pending.then(
      () => {},
      () => {},
    );
    return pending;
  }

  private async openNext(id: WorkspaceId) {
    const initial = await this.deps.repository.load(id);
    if (!initial) throw new AppFailure('REFERENCE_INVALID', 'Arbeitsbereich nicht gefunden.');
    await this.active?.close();
    this.active = undefined;
    const lease = await this.deps.lock.acquire(id, new AbortController().signal);
    try {
      const latest = await this.deps.repository.load(id);
      if (!latest) throw new AppFailure('REFERENCE_INVALID', 'Arbeitsbereich wurde entfernt.');
      let integrity: ArtifactReferenceCheck | undefined, integrityError: string | undefined;
      if (this.deps.artifacts)
        try {
          integrity = await new RecoveryService(this.deps.artifacts).inspect(
            latest,
            new AbortController().signal,
          );
        } catch (error) {
          integrityError = String(error);
        }
      const session = new WorkspaceEditingSession(
        parseWorkspace(latest),
        lease,
        this.deps,
        integrity?.missing,
      );
      session.integrity = integrity;
      session.integrityError = integrityError;
      return (this.active = session);
    } catch (error) {
      await lease.release();
      throw error;
    }
  }
  async close() {
    return this.enqueue(async () => {
      await this.active?.close();
      this.active = undefined;
    });
  }
  async reacquire(id: string) {
    await this.close();
    return this.open(id);
  }
}

export type EditingSession = Pick<WorkspaceEditingSession, keyof WorkspaceEditingSession>;
