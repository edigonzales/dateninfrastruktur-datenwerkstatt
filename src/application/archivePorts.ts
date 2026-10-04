export interface ArchiveLimits {
  compressedBytes: number;
  expandedBytes: number;
  entryBytes: number;
  entries: number;
}
export const archiveDefaults: ArchiveLimits = {
  compressedBytes: 134217728,
  expandedBytes: 536870912,
  entryBytes: 134217728,
  entries: 4096,
};
export interface ArchiveCodec {
  read(file: Blob, signal: AbortSignal): Promise<Map<string, Uint8Array<ArrayBuffer>>>;
  write(files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, signal: AbortSignal): Promise<Blob>;
}
