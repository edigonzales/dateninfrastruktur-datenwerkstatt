import type {PublicSource, PublicFile, ResolvedCatalogTable} from './catalogPorts';
import type {ManagedArtifactStore} from './storagePorts';
import type {FileImportEngine, ImportFile, ImportPreview} from './importPorts';
import type {
  CsvImportOptions,
  DatasetId,
  Id,
  WorkspaceDocument,
  DatasetVersion,
  Dataset,
} from '../domain/model';
import {nameSchema, sqlNameSchema, suggestSqlName} from '../domain/workspace';
import {AppFailure} from './errors';
import type {WorkspaceScheduler} from './scheduler';
interface Dependencies {
  document(): WorkspaceDocument;
  assertWriter(): void;
  publish(change: (document: WorkspaceDocument) => void): Promise<void>;
  engine: FileImportEngine;
  publicSource?: PublicSource;
  scheduler?: WorkspaceScheduler;
  artifacts: ManagedArtifactStore;
  flush(): Promise<void>;
  newId: <K extends string>() => Id<K>;
  now(): string;
}
interface Staged {
  file: ImportFile;
  format: 'csv' | 'parquet';
  preview: ImportPreview;
  pending?: Promise<DatasetId>;
  portal?: {table: ResolvedCatalogTable; observed: PublicFile};
}
export class DatasetService {
  private staged = new Map<string, Staged>();
  private completed = new Map<string, DatasetId>();
  private maintenance = false;
  private lifetime = new AbortController();
  private jobs = new Set<Promise<unknown>>();
  constructor(private readonly deps: Dependencies) {}
  suggestName(fileName: string) {
    return suggestSqlName(
      fileName,
      Object.values(this.deps.document().datasets).map((d) => d.sqlName),
    );
  }
  private run<T>(
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
    writer = true,
  ): Promise<T> {
    if (writer) this.deps.assertWriter();
    if (this.maintenance)
      throw new AppFailure('VALIDATION_FAILED', 'Speicherbereinigung läuft. Bitte kurz warten.');
    if (this.lifetime.signal.aborted) throw new AppFailure('RUNTIME_RESET', 'Sitzung geschlossen.');
    const joined = AbortSignal.any([signal, this.lifetime.signal]);
    const job =
      writer && this.deps.scheduler
        ? this.deps.scheduler.run('Daten verarbeiten', joined, work)
        : work(joined);
    this.jobs.add(job);
    void job.finally(() => this.jobs.delete(job)).catch(() => {});
    return job;
  }
  preview(
    file: ImportFile,
    format: 'csv' | 'parquet',
    options: CsvImportOptions | undefined,
    signal: AbortSignal,
  ) {
    return this.run(signal, async (activeSignal) => {
      const preview = await this.deps.engine.preview(file, format, options, activeSignal);
      this.staged.set(preview.key, {file, format, preview});
      return preview;
    });
  }
  previewPortal(table: ResolvedCatalogTable, signal: AbortSignal) {
    return this.run(signal, async (activeSignal) => {
      if (!this.deps.publicSource)
        throw new AppFailure('SOURCE_UNAVAILABLE', 'Portalzugriff fehlt.');
      const observed = await this.deps.publicSource.fetch(table.publicParquetUrl, activeSignal);
      const file = new File([observed.bytes], `${table.tableId}.parquet`);
      const preview = await this.deps.engine.preview(file, 'parquet', undefined, activeSignal);
      // File types are authoritative; descriptions/roles from the validated portal remain metadata.
      for (const c of preview.schema.columns) {
        const hint = table.schemaHint?.columns.find((h) => h.name === c.name);
        if (hint) {
          c.roles = hint.roles;
          if (hint.description) c.description = hint.description;
        }
      }
      preview.sourceSha256 = observed.sha256;
      this.staged.set(preview.key, {file, format: 'parquet', preview, portal: {table, observed}});
      return preview;
    });
  }
  confirm(
    key: string,
    selection: {
      name: string;
      sqlName: string;
      keepOriginal: boolean;
      local?: boolean;
      replace?: DatasetId;
    },
    signal: AbortSignal,
  ) {
    const completed = this.completed.get(key);
    if (completed) return Promise.resolve(completed);
    const stage = this.staged.get(key);
    if (!stage)
      return Promise.reject(new AppFailure('IMPORT_INVALID', 'Bitte zuerst eine Vorschau prüfen.'));
    // Repeat confirmation of the same preview joins one operation; retry after failure is explicit.
    if (stage.pending) return stage.pending;
    const pending = this.run(signal, async (activeSignal) => {
      const name = nameSchema.parse(selection.name);
      const sqlName = sqlNameSchema.parse(selection.sqlName);
      const initial = this.deps.document();
      const existing = selection.replace ? initial.datasets[selection.replace] : undefined;
      if (selection.replace && (!existing || existing.removedAt))
        throw new AppFailure('REFERENCE_INVALID', 'Datensatz nicht mehr aktiv.');
      if (existing && existing.sqlName !== sqlName)
        throw new AppFailure(
          'VALIDATION_FAILED',
          'Technischer Name bleibt beim Ersetzen unverändert.',
        );
      if (
        Object.values(initial.datasets).some((d) => d.id !== existing?.id && d.sqlName === sqlName)
      )
        throw new AppFailure('VALIDATION_FAILED', 'SQL-Name ist bereits reserviert.');
      const prepared = await this.deps.engine.prepare(key, activeSignal);
      const artifact =
        !stage.portal || selection.local
          ? await this.deps.artifacts.write(
              initial.workspace.id,
              prepared.data,
              'application/vnd.apache.parquet',
              activeSignal,
            )
          : undefined;
      if (!artifact) await prepared.data.cancel();
      const portal = stage.portal;
      if (portal && !selection.local) {
        const latest = await this.deps.publicSource!.fetch(
          portal.table.publicParquetUrl,
          activeSignal,
        );
        if (latest.sha256 !== portal.observed.sha256 || latest.etag !== portal.observed.etag)
          throw new AppFailure('SOURCE_CHANGED', 'SOURCE_CHANGED: Quelle seit Vorschau geändert.');
      }
      const original =
        stage.format === 'csv' && selection.keepOriginal
          ? await this.deps.artifacts.write(
              initial.workspace.id,
              stage.file.stream(),
              'text/csv',
              activeSignal,
            )
          : undefined;
      activeSignal.throwIfAborted();
      const id = existing?.id ?? this.deps.newId<'dataset'>();
      const versionId = this.deps.newId<'dataset-version'>();
      const now = this.deps.now();
      const version: DatasetVersion = {
        id: versionId,
        workspaceId: initial.workspace.id,
        datasetId: id,
        origin: portal
          ? {
              kind: 'portal',
              providerId: portal.table.providerId,
              target: portal.table.target,
              tableId: portal.table.tableId,
              observedAt: portal.table.observedAt,
              canonicalUrl: portal.table.canonicalUrl,
              ...(portal.table.license ? {license: portal.table.license} : {}),
            }
          : {
              kind: 'file',
              fileName: stage.file.name,
              format: stage.format,
              ...(original ? {originalArtifactId: original.id} : {}),
              ...(stage.preview.csvOptions ? {csvOptions: stage.preview.csvOptions} : {}),
            },
        backing: artifact
          ? {kind: 'artifact', artifactId: artifact.id}
          : {
              kind: 'public-parquet',
              url: portal!.table.publicParquetUrl,
              ...(portal!.observed.etag ? {etag: portal!.observed.etag} : {}),
              ...(portal!.observed.lastModified
                ? {lastModified: portal!.observed.lastModified}
                : {}),
            },
        evidence: {kind: 'sha256', value: artifact?.sha256 ?? portal!.observed.sha256},
        schema: portal ? stage.preview.schema : prepared.schema,
        rowCount: prepared.rowCount,
        createdAt: now,
      };
      const dataset: Dataset = {
        id,
        workspaceId: initial.workspace.id,
        name,
        sqlName,
        currentVersionId: versionId,
        createdAt: existing?.createdAt ?? now,
      };
      await this.deps.publish((d) => {
        if (Object.values(d.datasets).some((other) => other.id !== id && other.sqlName === sqlName))
          throw new AppFailure('VALIDATION_FAILED', 'SQL-Name wurde inzwischen vergeben.');
        if (existing && d.datasets[id]?.currentVersionId !== existing.currentVersionId)
          throw new AppFailure('REVISION_CONFLICT', 'Datenstand wurde inzwischen ersetzt.');
        if (artifact) d.artifacts[artifact.id] = artifact;
        if (original) d.artifacts[original.id] = original;
        d.datasetVersions[version.id] = version;
        d.datasets[id] = dataset;
        d.workspace.updatedAt = now;
      });
      this.completed.set(key, id);
      this.staged.delete(key);
      await this.deps.engine.release(key);
      return id;
    });
    stage.pending = pending;
    void pending.catch(() => {
      delete stage.pending;
    });
    return pending;
  }
  async discard(key: string) {
    this.staged.delete(key);
    await this.deps.engine.release(key);
  }
  async export(id: DatasetId, signal: AbortSignal) {
    const doc = this.deps.document();
    const dataset = doc.datasets[id];
    const version = dataset && doc.datasetVersions[dataset.currentVersionId];
    if (version?.backing.kind === 'public-parquet' && this.deps.publicSource) {
      const source = await this.deps.publicSource.fetch(version.backing.url, signal, version);
      return new Blob([source.bytes]).stream();
    }
    if (!version || version.backing.kind !== 'artifact')
      throw new AppFailure('ARTIFACT_MISSING', 'Keine lokale Datei vorhanden.');
    const artifact = doc.artifacts[version.backing.artifactId];
    if (!artifact) throw new AppFailure('ARTIFACT_MISSING', 'Artefaktmetadaten fehlen.');
    return this.deps.artifacts.read(artifact, signal);
  }
  keepLocal(id: DatasetId, signal: AbortSignal) {
    return this.run(signal, async (activeSignal) => {
      const doc = this.deps.document();
      const dataset = doc.datasets[id];
      const version = dataset && doc.datasetVersions[dataset.currentVersionId];
      if (!dataset || !version || version.backing.kind !== 'public-parquet')
        throw new AppFailure('SOURCE_UNAVAILABLE', 'Keine öffentliche Referenz.');
      const artifact = await this.deps.artifacts.write(
        doc.workspace.id,
        await this.export(id, activeSignal),
        'application/vnd.apache.parquet',
        activeSignal,
      );
      const next: DatasetVersion = {
        ...version,
        id: this.deps.newId<'dataset-version'>(),
        createdAt: this.deps.now(),
        backing: {kind: 'artifact', artifactId: artifact.id},
        evidence: {kind: 'sha256', value: artifact.sha256},
      };
      await this.deps.publish((d) => {
        if (d.datasets[id]?.currentVersionId !== version.id)
          throw new AppFailure('REVISION_CONFLICT', 'Stand inzwischen ersetzt.');
        d.artifacts[artifact.id] = artifact;
        d.datasetVersions[next.id] = next;
        d.datasets[id]!.currentVersionId = next.id;
      });
      return next.id;
    });
  }
  async inspect(id: DatasetId, signal: AbortSignal) {
    return this.run(
      signal,
      async (activeSignal) => {
        const data = await this.export(id, activeSignal);
        const preview = await this.deps.engine.inspect(data, activeSignal);
        await this.deps.engine.release(preview.key);
        return preview;
      },
      false,
    );
  }
  async inventory(signal: AbortSignal) {
    const doc = this.deps.document();
    const missing: string[] = [];
    for (const artifact of Object.values(doc.artifacts)) {
      signal.throwIfAborted();
      if (!(await this.deps.artifacts.exists(artifact))) missing.push(artifact.id);
    }
    const referenced = new Set(Object.values(doc.artifacts).map((a) => a.path));
    const orphans: string[] = [];
    for await (const file of this.deps.artifacts.list(doc.workspace.id)) {
      signal.throwIfAborted();
      if (!referenced.has(file.path)) orphans.push(file.path);
    }
    return {missing, orphans};
  }
  async cleanOrphans(signal: AbortSignal) {
    return this.run(signal, async (activeSignal) => {
      if (this.jobs.size > (this.deps.scheduler ? 1 : 0))
        throw new AppFailure('VALIDATION_FAILED', 'Aktive Dateioperation zuerst abschliessen.');
      this.maintenance = true;
      try {
        await this.deps.flush();
        activeSignal.throwIfAborted();
        const inventory = await this.inventory(activeSignal);
        for (const path of inventory.orphans) {
          activeSignal.throwIfAborted();
          await this.deps.artifacts.deleteUnreferenced(this.deps.document().workspace.id, path);
        }
        return inventory.orphans.length;
      } finally {
        this.maintenance = false;
      }
    });
  }
  async close() {
    this.lifetime.abort();
    await Promise.allSettled(this.jobs);
    this.staged.clear();
    this.completed.clear();
    await this.deps.engine.dispose();
  }
}
