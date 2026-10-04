import {deflateRawSync} from 'node:zlib';
import {crc32} from '../../src/infrastructure/archive/zip';
/** Hostile ZIP fixture generator; no production importer is used to form directory fields. */
export function rawZip(
  entries: {name: string; data: Uint8Array; size?: number; attrs?: number; method?: number}[],
) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name),
      method = e.method ?? 0,
      compressed = method === 8 ? deflateRawSync(e.data) : Buffer.from(e.data),
      size = e.size ?? e.data.length,
      crc = crc32(e.data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(compressed.length, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x0314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(e.attrs ?? 0x81a40000, 38);
    c.writeUInt32LE(offset, 42);
    local.push(h, name, compressed);
    central.push(c, name);
    offset += h.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Blob([new Uint8Array(Buffer.concat([...local, directory, end]))]);
}
