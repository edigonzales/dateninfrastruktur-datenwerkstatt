import {guardQuery} from '../../src/infrastructure/sqlrooms/queryGuard';
import {createWorkspaceRoom} from '../../src/infrastructure/sqlrooms/room';
import Dexie, {type EntityTable} from 'dexie';
import type {WebR} from 'webr';

let room: ReturnType<typeof createWorkspaceRoom> | undefined;
let initializationCount = 0;
export async function sqlInit() {
  if (!room) {
    room = createWorkspaceRoom();
    initializationCount++;
  }
  await room.initialize();
  return initializationCount;
}
export async function sql(code: string) {
  await sqlInit();
  const table = await room!.connector.getConnection().query(code);
  return {
    rows: table.toArray().map((row) => row.toJSON() as Record<string, unknown>),
    columns: table.schema.fields.map((f) => ({name: f.name, type: f.type.toString()})),
  };
}
export async function sqlSmoke() {
  await Promise.all([sqlInit(), sqlInit()]);
  const connector = room!.connector;
  const connection = connector.getConnection();
  await connector
    .getDb()
    .registerFileBuffer('probe.csv', new TextEncoder().encode('id;wert\n001;4\n002;7\n'));
  await connection.query(
    "CREATE TABLE probe AS SELECT * FROM read_csv('probe.csv', delim=';', columns={'id':'VARCHAR','wert':'INTEGER'})",
  );
  await connection.query("COPY probe TO 'probe.parquet' (FORMAT PARQUET)");
  const bytes = await connector.getDb().copyFileToBuffer('probe.parquet');
  const table = await connection.query("SELECT * FROM read_parquet('probe.parquet') ORDER BY id");
  const stable = await connection.query('SELECT i, random() AS r FROM range(350) AS t(i)');
  const row = stable.getChildAt(1)!.get(220) as number;
  await connection.query('SELECT random()');
  const version = await connection.query('SELECT version() AS version');
  return {
    initializationCount,
    rows: table.toArray().map((r) => r.toJSON() as Record<string, unknown>),
    bytes: bytes.length,
    arrow: table.constructor.name,
    stableRows: stable.numRows,
    stable: stable.getChildAt(1)!.get(220) === row,
    version: String(version.getChildAt(0)!.get(0)),
  };
}
export async function parseSql(code: string) {
  await sqlInit();
  const t = await room!.connector
    .getConnection()
    .query(`SELECT json_serialize_sql('${code.replaceAll("'", "''")}') AS ast`);
  return JSON.parse(String(t.getChildAt(0)!.get(0))) as unknown;
}
export async function sqlCancel() {
  await sqlInit();
  const current = room!;
  const connection = current.connector.getConnection();
  let settled = false;
  const pending = connection.query('SELECT sum(sin(i::DOUBLE)) FROM range(10000000000) t(i)').then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const wasRunning = !settled;
  let cancelSettled = false;
  void connection.cancelSent().then(
    () => {
      cancelSettled = true;
    },
    () => {
      cancelSettled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const neededReset = !settled;
  if (neededReset) await current.terminate();
  else await current.close();
  room = undefined;
  // The terminated worker's pending query may not settle in this baseline.
  void pending;
  const fresh = await sql('SELECT 7 AS wert');
  return {wasRunning, settled, cancelSettled, neededReset, fresh};
}
let webR: WebR | undefined;
let rInit: Promise<WebR> | undefined;
let rEpoch = 0;
export function initR(): Promise<WebR> {
  return (rInit ??= (async () => {
    const moduleUrl = new URL('/vendor/webr/0.6.0/webr.js', location.origin).href;
    const module: typeof import('webr') = await import(/* @vite-ignore */ moduleUrl);
    webR = new module.WebR({
      baseUrl: '/vendor/webr/0.6.0/',
      repoUrl: '/vendor/webr-packages/',
      channelType: module.ChannelType.PostMessage,
      interactive: false,
    });
    await webR.init();
    await webR.evalRVoid('options(device = webr::canvas)');
    return webR;
  })());
}
export async function rSmoke() {
  const runtime = await initR();
  const env = await new runtime.REnvironment();
  const frame = await new runtime.RDataFrame({id: ['001', '002'], wert: [4, 7]});
  await env.bind('daten', frame);
  const sum = await runtime.evalRNumber('sum(daten$wert)', {env});
  const shelter = await new runtime.Shelter();
  try {
    const captured = await shelter.captureR('plot(daten$wert)', {
      env,
      captureGraphics: {width: 400, height: 300, bg: 'white', capture: true},
    });
    const images = captured.images.map((image) => {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
      const ink = pixels.filter((v, i) => i % 4 !== 3 && v < 200).length;
      const size = {width: image.width, height: image.height, ink};
      image.close();
      return size;
    });
    return {
      sum,
      images,
      version: await runtime.evalRString('R.version.string'),
      channel: 'PostMessage',
    };
  } finally {
    await shelter.purge();
    await runtime.destroy(env);
    await runtime.destroy(frame);
  }
}
export async function rCancel() {
  const runtime = await initR();
  let settled = false;
  void runtime.evalRVoid('repeat { x <- 1 + 1 }').then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  const wasRunning = !settled;
  runtime.close();
  rEpoch++;
  rInit = undefined;
  webR = undefined;
  const next = await initR();
  return {wasRunning, epoch: rEpoch, result: await next.evalRNumber('1 + 2')};
}
export async function storageSmoke() {
  const root = await navigator.storage.getDirectory().catch((e: unknown) => {
    throw new Error(`OPFS getDirectory: ${String(e)}`);
  });
  const name = `probe-${crypto.randomUUID()}`;
  const file = await root.getFileHandle(name, {create: true});
  const writer = await file.createWritable().catch((e: unknown) => {
    throw new Error(`OPFS createWritable: ${String(e)}`);
  });
  await writer.write(new Uint8Array([0, 1, 255]));
  await writer.close();
  const bytes = [...new Uint8Array(await (await file.getFile()).arrayBuffer())];
  await root.removeEntry(name);
  const db = new Dexie(`probe-${name}`) as Dexie & {
    items: EntityTable<{id: string; revision: number}, 'id'>;
  };
  db.version(1).stores({items: 'id'});
  try {
    await db.items.add({id: 'a', revision: 0});
    await db.transaction('rw', db.items, async () => {
      const row = await db.items.get('a');
      if (row?.revision !== 0) throw Error('Conflict');
      await db.items.put({id: 'a', revision: 1});
    });
    return {bytes, revision: (await db.items.get('a'))?.revision, locks: !!navigator.locks};
  } finally {
    await db.delete();
  }
}
let releaseLock: (() => void) | undefined;
let lockTask: Promise<void> | undefined;
export async function acquireLock(name: string) {
  return new Promise<boolean>((resolve, reject) => {
    lockTask = navigator.locks.request(name, {ifAvailable: true}, async (lock) => {
      resolve(!!lock);
      if (lock)
        await new Promise<void>((r) => {
          releaseLock = r;
        });
    });
    void lockTask.catch(reject);
  });
}
export async function release() {
  releaseLock?.();
  await lockTask;
}
export async function close() {
  await room?.close();
  webR?.close();
  await release();
}

export async function guarded(code: string) {
  await sqlInit();
  await guardQuery(room!.connector.getConnection(), code, new Set(['probe']));
  return true;
}
