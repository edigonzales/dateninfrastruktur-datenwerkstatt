import {z} from 'zod';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {ArchiveManifest, ArchiveInspection} from '../../contracts/archive';
import type {Artifact, ArtifactId, Id, WorkspaceDocument} from '../domain/model';
import {parseWorkspace, workspaceSchema} from '../domain/workspace';
import {remapWorkspace} from '../domain/remap';
import type {ArtifactStore, WorkspaceRepository, WorkspaceLock} from './ports';
import type {ArchiveCodec} from './archivePorts';
import type {PublicSource} from './catalogPorts';
import {AppFailure} from './errors';
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
function validateArchiveUrls(project: WorkspaceDocument) {
  const check = (value: string) => {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
      throw new AppFailure(
        'ARCHIVE_INVALID',
        'Archiv enthält eine nicht dauerhafte öffentliche Quellen-URL (Schema, Zugangsdaten oder URL-Parameter).',
      );
  };
  // Portable origin references need not exist in the receiving operator configuration.
  // Its allowlist is still enforced by PublicSource before any subsequent network request.
  for (const version of Object.values(project.datasetVersions)) {
    if (version.backing.kind === 'public-parquet') check(version.backing.url);
    if (version.origin.kind === 'portal') check(version.origin.canonicalUrl);
  }
}
const entry = (a: Artifact) =>
  `artifacts/${a.id}.${a.mediaType === 'image/png' ? 'png' : a.mediaType.includes('parquet') ? 'parquet' : a.mediaType.includes('csv') ? 'csv' : 'bin'}`;
const manifestSchema = z.strictObject({
  archiveFormat: z.literal('datenwerkstatt'),
  archiveVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  mode: z.enum(['recipe', 'with-data']),
  project: z.unknown(),
  files: z.array(
    z.strictObject({
      artifactId: z.uuid(),
      entry: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  omissions: z.array(z.strictObject({artifactId: z.uuid().optional(), reason: z.string()})),
});
interface Dependencies {
  codec: ArchiveCodec;
  artifacts: ArtifactStore;
  repository: WorkspaceRepository;
  lock: WorkspaceLock;
  publicSource?: PublicSource;
  newId: <K extends string>() => Id<K>;
  now(): string;
}
export interface ArchiveCandidate {
  id: string;
  inspection: ArchiveInspection;
}
export class WorkspaceArchive {
  private importing = false;
  private candidate:
    | {id: string; manifest: ArchiveManifest; files: Map<string, Uint8Array<ArrayBuffer>>}
    | undefined;
  constructor(private readonly deps: Dependencies) {}
  async inspect(file: Blob, signal: AbortSignal): Promise<ArchiveCandidate> {
    if (this.importing) throw new AppFailure('ARCHIVE_INVALID', 'Ein Archivimport läuft bereits.');
    this.candidate = undefined;
    try {
      const files = await this.deps.codec.read(file, signal),
        content = files.get('manifest.json');
      if (!content) throw Error('manifest.json fehlt.');
      const raw: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(content));
      const versions = z
        .object({
          archiveFormat: z.literal('datenwerkstatt'),
          archiveVersion: z.number(),
          project: z.object({formatVersion: z.number()}),
        })
        .safeParse(raw);
      if (
        versions.success &&
        (versions.data.archiveVersion !== 1 || versions.data.project.formatVersion !== 1)
      )
        throw new AppFailure('FORMAT_UNSUPPORTED', 'Unbekannte Archiv- oder Projektversion.');
      const m = manifestSchema.parse(raw),
        project = workspaceSchema.parse(m.project) as WorkspaceDocument;
      validateArchiveUrls(project);
      const expected = new Set(['manifest.json']),
        ids = new Set<string>();
      for (const f of m.files) {
        const a = project.artifacts[f.artifactId as ArtifactId];
        if (
          !a ||
          ids.has(f.artifactId) ||
          expected.has(f.entry) ||
          f.entry !== entry(a) ||
          a.path !== f.entry ||
          a.bytes !== f.bytes ||
          a.sha256 !== f.sha256
        )
          throw Error('Artefaktmanifest widersprüchlich.');
        const bytes = files.get(f.entry);
        if (!bytes || bytes.length !== f.bytes || hash(bytes) !== f.sha256)
          throw Error('Artefaktlänge oder SHA-256 stimmt nicht.');
        ids.add(f.artifactId);
        expected.add(f.entry);
      }
      if (m.mode === 'recipe' && m.files.length)
        throw Error('Recipe darf keine Artefaktbytes enthalten.');
      if (files.size !== expected.size || [...files.keys()].some((n) => !expected.has(n)))
        throw Error('Nicht manifestierte Datei.');
      for (const a of Object.values(project.artifacts)) {
        if (a.path !== entry(a)) throw Error('Artefaktpfad ist nicht portabel.');
        a.path = `workspaces/${project.workspace.id}/artifacts/${a.id}`;
      }
      const manifest: ArchiveManifest = {
        ...m,
        project: parseWorkspace(project),
        files: m.files as ArchiveManifest['files'],
        omissions: m.omissions as ArchiveManifest['omissions'],
      };
      const id = this.deps.newId();
      this.candidate = {id, manifest, files};
      const missing = Object.values(project.datasetVersions).filter(
        (v) =>
          v.backing.kind === 'missing' ||
          (v.backing.kind === 'artifact' && !ids.has(v.backing.artifactId)),
      ).length;
      const external = Object.values(project.datasetVersions).filter(
        (v) => v.backing.kind === 'public-parquet',
      ).length;
      return {
        id,
        inspection: {
          workspaceName: project.workspace.name,
          analyses: Object.keys(project.analyses).length,
          datasets: Object.keys(project.datasets).length,
          includedBytes: m.files.reduce((n, f) => n + f.bytes, 0),
          missingSources: missing + external,
          containsExecutableCode:
            Object.values(project.analyses).some((a) => !!a.code) ||
            Object.values(project.runs).some((r) => !!r.snapshot.code),
          warnings: [
            ...m.omissions.map((o) => o.reason),
            ...(external
              ? [`${external} externe Datenstände benötigen weiterhin Netzwerkzugriff.`]
              : []),
            ...(missing
              ? [`${missing} Datenstände fehlen; vorhandener Code bleibt bearbeitbar.`]
              : []),
          ],
        },
      };
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof AppFailure && e.code === 'FORMAT_UNSUPPORTED') throw e;
      throw new AppFailure('ARCHIVE_INVALID', e instanceof Error ? e.message : String(e));
    }
  }
  discard() {
    this.candidate = undefined;
  }
  async commitImport(id: string, signal: AbortSignal, name?: string) {
    const candidate = this.candidate;
    if (!candidate || candidate.id !== id)
      throw new AppFailure('ARCHIVE_INVALID', 'Archivvorschau fehlt oder ist veraltet.');
    if (this.importing) throw new AppFailure('ARCHIVE_INVALID', 'Ein Archivimport läuft bereits.');
    this.importing = true;
    const workspaceId = this.deps.newId<'workspace'>();
    const lease = await this.deps.lock.acquire(workspaceId, signal).catch((error) => {
      this.importing = false;
      throw error;
    });
    try {
      if (lease.mode !== 'writer')
        throw new AppFailure('READ_ONLY_WORKSPACE', 'Kein exklusives Importrecht.');
      const artifacts = new Map<ArtifactId, Artifact>();
      for (const f of candidate.manifest.files) {
        signal.throwIfAborted();
        const original = candidate.manifest.project.artifacts[f.artifactId]!;
        const artifact = await this.deps.artifacts.write(
          workspaceId,
          new Blob([candidate.files.get(f.entry)!]).stream(),
          original.mediaType,
          signal,
        );
        if (artifact.sha256 !== f.sha256 || artifact.bytes !== f.bytes)
          throw new AppFailure('ARTIFACT_CORRUPT', 'Geschriebene Importdatei stimmt nicht.');
        artifacts.set(f.artifactId, artifact);
      }
      signal.throwIfAborted();
      const doc = remapWorkspace(
        candidate.manifest.project,
        artifacts,
        this.deps.newId,
        this.deps.now(),
        workspaceId,
      );
      if (name !== undefined) doc.workspace.name = name;
      const saved = await this.deps.repository.create(parseWorkspace(doc));
      this.candidate = undefined;
      return saved;
    } finally {
      this.importing = false;
      await lease.release();
    }
  }
  async export(
    document: WorkspaceDocument,
    mode: 'recipe' | 'with-data',
    includeExternal: boolean,
    signal: AbortSignal,
  ) {
    validateArchiveUrls(document);
    const project = structuredClone(document),
      files = new Map<string, Uint8Array<ArrayBuffer>>(),
      included: ArchiveManifest['files'] = [],
      omissions: ArchiveManifest['omissions'] = [];
    if (mode === 'with-data' && includeExternal) {
      for (const v of Object.values(project.datasetVersions))
        if (v.backing.kind === 'public-parquet') {
          try {
            if (!this.deps.publicSource) throw Error('Öffentliche Quelle nicht konfiguriert.');
            const data = await this.deps.publicSource.fetch(v.backing.url, signal, v),
              id = this.deps.newId<'artifact'>();
            const a: Artifact = {
              id,
              workspaceId: project.workspace.id,
              path: `workspaces/${project.workspace.id}/artifacts/${id}`,
              bytes: data.bytes.length,
              sha256: data.sha256,
              mediaType: 'application/vnd.apache.parquet',
              createdAt: this.deps.now(),
            };
            project.artifacts[id] = a;
            v.backing = {kind: 'artifact', artifactId: id};
            v.evidence = {kind: 'sha256', value: a.sha256};
            files.set(entry(a), new Uint8Array(data.bytes));
          } catch (e) {
            signal.throwIfAborted();
            omissions.push({
              reason: `Externer Datenstand ${v.id}: ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }
    }
    for (const a of Object.values(project.artifacts)) {
      signal.throwIfAborted();
      if (mode === 'with-data') {
        try {
          const bytes =
            files.get(entry(a)) ??
            new Uint8Array(
              await new Response(await this.deps.artifacts.read(a, signal)).arrayBuffer(),
            );
          if (bytes.length !== a.bytes || hash(bytes) !== a.sha256)
            throw Error('Dateihash stimmt nicht.');
          files.set(entry(a), bytes);
          included.push({artifactId: a.id, entry: entry(a), bytes: a.bytes, sha256: a.sha256});
        } catch (e) {
          signal.throwIfAborted();
          omissions.push({
            artifactId: a.id,
            reason: `Datei ${a.id} fehlt oder ist beschädigt: ${String(e)}`,
          });
        }
      } else
        omissions.push({artifactId: a.id, reason: 'Recipe enthält keine lokalen Artefaktbytes.'});
      a.path = entry(a);
    }
    for (const r of Object.values(project.results))
      if (r.materialization.kind === 'session') {
        r.materialization = {kind: 'unavailable', reason: 'recipe-import'};
        omissions.push({reason: `Temporäres Resultat ${r.name} wurde nicht mitgeliefert.`});
      } else if (r.materialization.kind === 'unavailable')
        omissions.push({
          reason: `Resultat ${r.name} ist nicht verfügbar (${r.materialization.reason}).`,
        });
    for (const v of Object.values(project.datasetVersions))
      if (v.backing.kind !== 'artifact')
        omissions.push({
          reason: `Datenstand ${v.id}: ${v.backing.kind === 'public-parquet' ? 'externe Referenz, nicht offline verfügbar' : 'Quelle fehlt'}.`,
        });
    for (const r of Object.values(project.runs))
      if (['queued', 'running', 'cancelling'].includes(r.status)) {
        r.status = 'interrupted';
        r.stopReason = 'runtime-crash';
        r.finishedAt = this.deps.now();
      }
    const manifest: ArchiveManifest = {
      archiveFormat: 'datenwerkstatt',
      archiveVersion: 1,
      exportedAt: this.deps.now(),
      mode,
      project,
      files: included,
      omissions,
    };
    files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
    return {blob: await this.deps.codec.write(files, signal), manifest};
  }
}
