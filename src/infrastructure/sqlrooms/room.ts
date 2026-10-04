import {checkRuntimeAsset} from '../browser/runtimeAsset';
import {measure} from '../../application/diagnostics';
import {
  createDuckDbSlice,
  createWasmDuckDbConnector,
  type DuckDbSliceState,
} from '@sqlrooms/duckdb';
import {createBaseRoomSlice, type BaseRoomStoreState} from '@sqlrooms/room-store';
import {createStore} from 'zustand/vanilla';
/** One connector per room; this factory is owned by a session, never by a panel. */
export function createWorkspaceRoom() {
  const asset = (name: string) => `${import.meta.env.BASE_URL}vendor/duckdb/1.33.1-dev57.0/${name}`;
  const repository = new URL(`${import.meta.env.BASE_URL}vendor/duckdb-extensions`, location.origin)
    .href;
  const connector = createWasmDuckDbConnector({
    bundles: {
      mvp: {
        mainWorker: asset('duckdb-browser-mvp.worker.js'),
        mainModule: asset('duckdb-mvp.wasm'),
      },
      eh: {mainWorker: asset('duckdb-browser-eh.worker.js'), mainModule: asset('duckdb-eh.wasm')},
    },
    path: ':memory:',
    initializationQuery: `SET custom_extension_repository='${repository.replaceAll("'", "''")}';`,
  });
  // SQLRooms' createRoomStore starts every slice immediately. The session owns
  // this explicit initializer so asset failures cannot leave a background worker.
  const roomStore = createStore<BaseRoomStoreState & DuckDbSliceState>((set, get, store) => ({
    ...createBaseRoomSlice()(set, get, store),
    ...createDuckDbSlice({connector})(set, get, store),
  }));
  let initialization: Promise<void> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    roomStore,
    connector,
    initialize(signal: AbortSignal = new AbortController().signal) {
      if (closed) return Promise.reject(new Error('Sitzung geschlossen.'));
      return (initialization ??= measure('SQL Worker initialisieren', async () => {
        for (const bundle of ['mvp', 'eh']) {
          await checkRuntimeAsset(asset(`duckdb-${bundle}.wasm`), 'wasm', signal);
          await checkRuntimeAsset(
            asset(`duckdb-browser-${bundle}.worker.js`),
            'javascript',
            signal,
          );
        }
        await roomStore.getState().room.initialize();
        roomStore.setState((state) => ({room: {...state.room, initialized: true}}));
      }).catch((error) => {
        initialization = undefined;
        throw error;
      }));
    },
    close() {
      closed = true;
      return (closing ??= (async () => {
        try {
          await initialization;
        } finally {
          await roomStore.getState().room.destroy();
        }
      })());
    },
    /** Emergency stop must bypass connector.destroy(), which waits for conn.close(). */
    terminate() {
      closed = true;
      return (closing ??= (async () => {
        try {
          await connector.getDb().terminate();
        } catch {
          // Aborting before feature detection completed still waits for and then ends that worker.
          await initialization;
          if (initialization) await connector.getDb().terminate();
        }
      })());
    },
  };
}
