import {AppFailure} from '../../application/errors';
import {
  archiveDefaults,
  type ArchiveCodec,
  type ArchiveLimits,
} from '../../application/archivePorts';
const invalid = (message: string): never => {
  throw new AppFailure('ARCHIVE_INVALID', message);
};
const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', {fatal: true});
const crcTable = Uint32Array.from({length: 256}, (_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function archivePath(name: string) {
  // A canonical subset: alternate spellings are rejected, never used as filesystem paths.
  if (name !== 'manifest.json' && !/^artifacts\/[a-f0-9-]{36}\.[a-z0-9]{1,12}$/.test(name))
    invalid(`Unzulässiger Archiveintrag: ${name.slice(0, 120)}`);
  return name;
}
/** Regular ZIP32 files, stored or deflated. ZIP64/encryption/multidisk are intentionally rejected. */
export class ZipArchiveCodec implements ArchiveCodec {
  constructor(private readonly limits: ArchiveLimits = archiveDefaults) {}
  async read(file: Blob, signal: AbortSignal) {
    signal.throwIfAborted();
    if (file.size > this.limits.compressedBytes || file.size < 22)
      invalid('Archivgrösse überschritten oder ZIP unvollständig.');
    const bytes = new Uint8Array(await file.arrayBuffer()),
      view = new DataView(bytes.buffer);
    const u16 = (n: number) => {
      if (n < 0 || n + 2 > bytes.length) invalid('ZIP abgeschnitten.');
      return view.getUint16(n, true);
    };
    const u32 = (n: number) => {
      if (n < 0 || n + 4 > bytes.length) invalid('ZIP abgeschnitten.');
      return view.getUint32(n, true);
    };
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--)
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
    if (end < Math.max(0, bytes.length - 65557)) invalid('ZIP-Endverzeichnis fehlt.');
    const count = u16(end + 10),
      centralSize = u32(end + 12),
      centralStart = u32(end + 16);
    if (
      u16(end + 4) ||
      u16(end + 6) ||
      u16(end + 8) !== count ||
      !count ||
      count > this.limits.entries ||
      count === 65535 ||
      centralStart + centralSize !== end
    )
      invalid('ZIP-Verzeichnis oder Eintragslimit ungültig.');
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const ranges: {start: number; end: number}[] = [];
    let at = centralStart,
      expanded = 0;
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      if (u32(at) !== 0x02014b50) invalid('Ungültiger ZIP-Verzeichniseintrag.');
      const flags = u16(at + 8),
        method = u16(at + 10),
        crc = u32(at + 16),
        compressed = u32(at + 20),
        size = u32(at + 24),
        names = u16(at + 28),
        extra = u16(at + 30),
        comment = u16(at + 32),
        attrs = u32(at + 38),
        offset = u32(at + 42);
      const mode = (attrs >>> 16) & 0xf000;
      if (
        flags & ~0x0808 ||
        ![0, 8].includes(method) ||
        u16(at + 34) ||
        (attrs & 16) !== 0 ||
        (mode !== 0 && mode !== 0x8000)
      )
        invalid('Nur reguläre, unverschlüsselte ZIP-Dateien sind erlaubt; keine Symlinks.');
      if (at + 46 + names + extra + comment > end) invalid('ZIP-Verzeichnis abgeschnitten.');
      const name = archivePath(decoder.decode(bytes.subarray(at + 46, at + 46 + names)));
      if (files.has(name)) invalid('Doppelter normalisierter Archiveintrag.');
      if (
        size > this.limits.entryBytes ||
        expanded + size > this.limits.expandedBytes ||
        (size > 1048576 && size > 200 * Math.max(1, compressed))
      )
        invalid('ZIP-Expansion überschreitet das Budget.');
      if (
        offset >= centralStart ||
        u32(offset) !== 0x04034b50 ||
        u16(offset + 6) !== flags ||
        u16(offset + 8) !== method
      )
        invalid('Lokaler ZIP-Header widerspricht dem Verzeichnis.');
      const localNames = u16(offset + 26),
        localExtra = u16(offset + 28),
        start = offset + 30 + localNames + localExtra;
      if (
        start + compressed > centralStart ||
        decoder.decode(bytes.subarray(offset + 30, offset + 30 + localNames)) !== name
      )
        invalid('ZIP-Dateibereich oder Name ungültig.');
      let finish = start + compressed;
      if (flags & 8) {
        let descriptor = finish;
        if (u32(descriptor) === 0x08074b50) descriptor += 4;
        if (
          u32(descriptor) !== crc ||
          u32(descriptor + 4) !== compressed ||
          u32(descriptor + 8) !== size
        )
          invalid('Ungültiger ZIP-Datendeskriptor.');
        finish = descriptor + 12;
      } else if (
        u32(offset + 14) !== crc ||
        u32(offset + 18) !== compressed ||
        u32(offset + 22) !== size
      )
        invalid('Widersprüchliche ZIP-Längen/CRC.');
      if (finish > centralStart || ranges.some((r) => offset < r.end && finish > r.start))
        invalid('Überlappende ZIP-Einträge.');
      ranges.push({start: offset, end: finish});
      let stream = new Blob([bytes.subarray(start, start + compressed)]).stream();
      if (method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(),
        chunks: Uint8Array<ArrayBuffer>[] = [];
      let actual = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          actual += part.value.byteLength;
          // Count actual expansion, including archives with deliberately false header sizes.
          if (
            actual > size ||
            actual > this.limits.entryBytes ||
            expanded + actual > this.limits.expandedBytes ||
            (actual > 1048576 && actual > 200 * Math.max(1, compressed))
          )
            invalid('Tatsächliche ZIP-Expansion überschreitet das Budget.');
          chunks.push(new Uint8Array(part.value));
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (actual !== size) invalid('ZIP-Länge stimmt nicht.');
      const content = new Uint8Array(actual);
      let cursor = 0;
      for (const chunk of chunks) {
        content.set(chunk, cursor);
        cursor += chunk.length;
      }
      if (crc32(content) !== crc) invalid('ZIP-CRC stimmt nicht.');
      files.set(name, content);
      expanded += actual;
      at += 46 + names + extra + comment;
    }
    if (at !== end) invalid('Nicht deklarierte ZIP-Verzeichnisdaten.');
    ranges.sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const range of ranges) {
      if (range.start !== cursor) invalid('Nicht manifestierte ZIP-Bereiche.');
      cursor = range.end;
    }
    if (cursor !== centralStart) invalid('Nicht manifestierte ZIP-Daten.');
    return files;
  }
  async write(files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, signal: AbortSignal) {
    if (!files.size || files.size > this.limits.entries) invalid('Zu viele Archiveinträge.');
    const data: Uint8Array<ArrayBuffer>[] = [],
      central: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0,
      total = 0;
    for (const [name, bytes] of files) {
      signal.throwIfAborted();
      archivePath(name);
      total += bytes.length;
      if (bytes.length > this.limits.entryBytes || total > this.limits.expandedBytes)
        invalid('Archivdaten überschreiten das Budget.');
      const n = encoder.encode(name),
        crc = crc32(bytes),
        header = new Uint8Array(30 + n.length),
        h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x800, true);
      h.setUint16(12, 33, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, bytes.length, true);
      h.setUint32(22, bytes.length, true);
      h.setUint16(26, n.length, true);
      header.set(n, 30);
      const record = new Uint8Array(46 + n.length),
        v = new DataView(record.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 0x0314, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x800, true);
      v.setUint16(14, 33, true);
      v.setUint32(16, crc, true);
      v.setUint32(20, bytes.length, true);
      v.setUint32(24, bytes.length, true);
      v.setUint16(28, n.length, true);
      v.setUint32(38, 0x81a40000, true);
      v.setUint32(42, offset, true);
      record.set(n, 46);
      data.push(header, bytes);
      central.push(record);
      offset += header.length + bytes.length;
      if (offset > this.limits.compressedBytes) invalid('ZIP überschreitet das Archivbudget.');
    }
    const size = central.reduce((n, b) => n + b.length, 0),
      end = new Uint8Array(22),
      v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, files.size, true);
    v.setUint16(10, files.size, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
    if (offset + size + 22 > this.limits.compressedBytes)
      invalid('ZIP überschreitet das Archivbudget.');
    return new Blob([...data, ...central, end], {type: 'application/zip'});
  }
}
