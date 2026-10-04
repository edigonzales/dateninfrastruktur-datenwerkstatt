import Dexie, {type EntityTable} from 'dexie';
import type {BrowserCapabilities} from '../../application/ports';
export async function probeCapabilities(): Promise<{
  capabilities: BrowserCapabilities;
  errors: string[];
}> {
  const errors: string[] = [];
  const capabilities: BrowserCapabilities = {
    indexedDb: false,
    opfs: false,
    webLocks: !!navigator.locks,
    crossOriginIsolated,
  };
  const marker = `datenwerkstatt-probe-${crypto.randomUUID()}`;
  const probe = new Dexie(marker) as Dexie & {
    checks: EntityTable<{id: string; value: string}, 'id'>;
  };
  probe.version(1).stores({checks: 'id'});
  try {
    await probe.checks.put({id: marker, value: 'probe'});
    if ((await probe.checks.get(marker))?.value !== 'probe')
      throw Error('IndexedDB-Leseprobe stimmt nicht überein.');
    await probe.checks.delete(marker);
    await probe.delete();
    capabilities.indexedDb = true;
  } catch (error) {
    errors.push(`IndexedDB: ${String(error)}`);
  } finally {
    probe.close();
  }
  let root: FileSystemDirectoryHandle | undefined;
  try {
    root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(marker, {create: true});
    const file = await directory.getFileHandle('probe', {create: true});
    const stream = await file.createWritable();
    await stream.write(new Uint8Array([0, 1, 255]));
    await stream.close();
    const read = new Uint8Array(await (await file.getFile()).arrayBuffer());
    if (read.length !== 3 || read[0] !== 0 || read[1] !== 1 || read[2] !== 255)
      throw Error('OPFS-Leseprobe stimmt nicht überein.');
    await root.removeEntry(marker, {recursive: true});
    capabilities.opfs = true;
  } catch (error) {
    errors.push(`OPFS: ${String(error)}`);
  } finally {
    await root?.removeEntry(marker, {recursive: true}).catch(() => {});
  }
  if (!capabilities.webLocks)
    errors.push('Web Locks fehlen; gespeicherte Projekte können nur gelesen werden.');
  return {capabilities, errors};
}

export async function storageEstimate(): Promise<{usage?: number; quota?: number}> {
  const estimate = await navigator.storage.estimate();
  return {
    ...(estimate.usage === undefined ? {} : {usage: estimate.usage}),
    ...(estimate.quota === undefined ? {} : {quota: estimate.quota}),
  };
}
