import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {Artifact, WorkspaceId} from '../../domain/model';
import {checkedId} from '../../domain/workspace';
import type {ManagedArtifactStore} from '../../application/storagePorts';
import {AppFailure} from '../../application/errors';

function ownedPath(artifact: Artifact) {
  checkedId(artifact.workspaceId);
  checkedId(artifact.id);
  const path = `workspaces/${artifact.workspaceId}/artifacts/${artifact.id}`;
  if (artifact.path !== path) throw new AppFailure('ARTIFACT_CORRUPT', 'Ungültiger Artefaktpfad.');
  return path;
}
function idForPath(workspaceId: WorkspaceId, path: string) {
  checkedId(workspaceId);
  const id = checkedId<'artifact'>(path.split('/').at(-1) ?? '');
  if (path !== `workspaces/${workspaceId}/artifacts/${id}`)
    throw new AppFailure('ARTIFACT_CORRUPT', 'Fremder Dateipfad wird nicht gelöscht.');
  return id;
}
function storageError(error: unknown): never {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    throw new AppFailure(
      'STORAGE_QUOTA',
      'Browser-Speicher voll. Datei wurde nicht veröffentlicht.',
      true,
    );
  throw error;
}
export async function hashStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  limit: number,
  consume?: (chunk: Uint8Array) => Promise<void>,
) {
  const reader = stream.getReader();
  const hash = sha256.create();
  let bytes = 0;
  let yieldedAt = 0;
  const abort = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array))
        throw new AppFailure('IMPORT_INVALID', 'Ungültiger Bytestrom.');
      bytes += part.value.byteLength;
      if (bytes > limit)
        throw new AppFailure('LIMIT_EXCEEDED', `Datei überschreitet ${limit} Bytes.`);
      hash.update(part.value);
      await consume?.(part.value);
      if (bytes - yieldedAt >= 4 * 1024 * 1024) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        yieldedAt = bytes;
      }
    }
    return {bytes, sha256: bytesToHex(hash.digest())};
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    hash.destroy();
  }
}
export class OpfsArtifactStore implements ManagedArtifactStore {
  readonly inFlight = new Set<string>();
  constructor(private readonly maxBytes: number) {}
  private async directory(workspaceId: WorkspaceId, create: boolean) {
    checkedId(workspaceId);
    const root = await navigator.storage.getDirectory();
    const workspaces = await root.getDirectoryHandle('workspaces', {create});
    const workspace = await workspaces.getDirectoryHandle(workspaceId, {create});
    return workspace.getDirectoryHandle('artifacts', {create});
  }
  async write(
    workspaceId: WorkspaceId,
    data: ReadableStream<Uint8Array>,
    mediaType: string,
    signal: AbortSignal,
  ): Promise<Artifact> {
    checkedId(workspaceId);
    const id = checkedId<'artifact'>(crypto.randomUUID());
    const path = `workspaces/${workspaceId}/artifacts/${id}`;
    this.inFlight.add(path);
    let writable: FileSystemWritableFileStream | undefined;
    try {
      signal.throwIfAborted();
      const directory = await this.directory(workspaceId, true);
      const handle = await directory.getFileHandle(id, {create: true});
      writable = await handle.createWritable();
      const writer = writable;
      const hashed = await hashStream(data, signal, this.maxBytes, async (chunk) => {
        // Copy only a bounded chunk to satisfy DOM's non-shared BufferSource contract.
        await writer.write(new Uint8Array(chunk));
      });
      signal.throwIfAborted();
      await writer.close();
      writable = undefined;
      const artifact: Artifact = {
        id,
        workspaceId,
        path,
        mediaType,
        ...hashed,
        createdAt: new Date().toISOString(),
      };
      if ((await this.verify(artifact, signal)) !== 'valid')
        throw new AppFailure(
          'ARTIFACT_CORRUPT',
          'Geschriebene Datei stimmt nicht mit dem Datenstrom überein.',
        );
      return artifact;
    } catch (error) {
      await writable?.abort().catch(() => {});
      storageError(error);
    } finally {
      this.inFlight.delete(path);
    }
  }
  private async file(artifact: Artifact) {
    ownedPath(artifact);
    const directory = await this.directory(artifact.workspaceId, false);
    return (await directory.getFileHandle(artifact.id)).getFile();
  }
  async read(artifact: Artifact, signal: AbortSignal) {
    signal.throwIfAborted();
    const state = await this.verify(artifact, signal);
    if (state !== 'valid')
      throw new AppFailure(
        state === 'corrupt' ? 'ARTIFACT_CORRUPT' : 'ARTIFACT_MISSING',
        'Gesicherte Datei fehlt oder ist beschädigt. Code und Metadaten bleiben erhalten.',
      );
    return (await this.file(artifact)).stream();
  }
  async exists(artifact: Artifact) {
    try {
      await this.file(artifact);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return false;
      throw error;
    }
  }
  async verify(artifact: Artifact, signal: AbortSignal): Promise<'valid' | 'missing' | 'corrupt'> {
    try {
      const file = await this.file(artifact);
      if (file.size !== artifact.bytes) return 'corrupt';
      const actual = await hashStream(file.stream(), signal, this.maxBytes);
      return actual.sha256 === artifact.sha256 ? 'valid' : 'corrupt';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return 'missing';
      throw error;
    }
  }
  async delete(artifact: Artifact) {
    ownedPath(artifact);
    await this.deleteUnreferenced(artifact.workspaceId, artifact.path);
  }
  async deleteUnreferenced(workspaceId: WorkspaceId, path: string) {
    const id = idForPath(workspaceId, path);
    if (this.inFlight.has(path))
      throw new AppFailure('READ_ONLY_WORKSPACE', 'Datei wird noch geschrieben.');
    try {
      await (await this.directory(workspaceId, false)).removeEntry(id);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }
  async *listWorkspaceIds() {
    const root = await navigator.storage.getDirectory();
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await root.getDirectoryHandle('workspaces');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      throw error;
    }
    const iterable = directory as FileSystemDirectoryHandle & {
      values(): AsyncIterable<FileSystemHandle>;
    };
    for await (const handle of iterable.values()) {
      if (handle.kind !== 'directory') continue;
      try {
        yield checkedId<'workspace'>(handle.name);
      } catch {
        /* Foreign directory is never touched. */
      }
    }
  }
  async *list(workspaceId: WorkspaceId) {
    let directory: FileSystemDirectoryHandle;
    try {
      directory = await this.directory(workspaceId, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      throw error;
    }
    // TS DOM omits the standard async iterator; validate handles received from this boundary.
    const iterable = directory as FileSystemDirectoryHandle & {
      values(): AsyncIterable<FileSystemHandle>;
    };
    for await (const handle of iterable.values()) {
      if (handle.kind !== 'file' || !/^[a-f0-9-]{36}$/.test(handle.name)) continue;
      const file = await (await directory.getFileHandle(handle.name)).getFile();
      yield {path: `workspaces/${workspaceId}/artifacts/${handle.name}`, bytes: file.size};
    }
  }
}
export class MemoryArtifactStore implements ManagedArtifactStore {
  private files = new Map<string, Blob>();
  constructor(private readonly maxBytes: number) {}
  async write(
    workspaceId: WorkspaceId,
    data: ReadableStream<Uint8Array>,
    mediaType: string,
    signal: AbortSignal,
  ): Promise<Artifact> {
    const id = checkedId<'artifact'>(crypto.randomUUID());
    const path = `workspaces/${workspaceId}/artifacts/${id}`;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const hashed = await hashStream(data, signal, this.maxBytes, async (chunk) => {
      chunks.push(new Uint8Array(chunk));
    });
    const artifact: Artifact = {
      id,
      workspaceId,
      path,
      mediaType,
      ...hashed,
      createdAt: new Date().toISOString(),
    };
    this.files.set(path, new Blob(chunks, {type: mediaType}));
    return artifact;
  }
  async read(artifact: Artifact, signal: AbortSignal) {
    const state = await this.verify(artifact, signal);
    if (state !== 'valid')
      throw new AppFailure(
        state === 'corrupt' ? 'ARTIFACT_CORRUPT' : 'ARTIFACT_MISSING',
        'Datei dieser Sitzung ist nicht verfügbar.',
      );
    return this.files.get(artifact.path)!.stream();
  }
  async exists(artifact: Artifact) {
    ownedPath(artifact);
    return this.files.has(artifact.path);
  }
  async verify(artifact: Artifact, signal: AbortSignal): Promise<'valid' | 'missing' | 'corrupt'> {
    ownedPath(artifact);
    const blob = this.files.get(artifact.path);
    if (!blob) return 'missing';
    const actual = await hashStream(blob.stream(), signal, this.maxBytes);
    return actual.sha256 === artifact.sha256 && actual.bytes === artifact.bytes
      ? 'valid'
      : 'corrupt';
  }
  async delete(artifact: Artifact) {
    ownedPath(artifact);
    this.files.delete(artifact.path);
  }
  async deleteUnreferenced(workspaceId: WorkspaceId, path: string) {
    idForPath(workspaceId, path);
    this.files.delete(path);
  }
  async *listWorkspaceIds() {
    const ids = new Set([...this.files.keys()].map((path) => path.split('/')[1]!));
    for (const id of ids) yield checkedId<'workspace'>(id);
  }
  async *list(workspaceId: WorkspaceId) {
    for (const [path, blob] of this.files)
      if (path.startsWith(`workspaces/${workspaceId}/artifacts/`)) yield {path, bytes: blob.size};
  }
}
