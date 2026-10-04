import {ZipArchiveCodec} from '../infrastructure/archive/zip';
import {WebREngine} from '../infrastructure/webr/engine';
import {encodePlot} from '../infrastructure/browser/png';
import {PortalAccess} from '../infrastructure/catalog/portal';
import {
  WorkspaceViewRepository,
  MemoryViewRepository,
  type ViewRepository,
} from '../infrastructure/storage/viewState';
import {OpfsArtifactStore, MemoryArtifactStore} from '../infrastructure/storage/artifactStore';
import {DuckDbRuntime} from '../infrastructure/sqlrooms/runtime';
import {SqlRoomsSqlEngine} from '../infrastructure/sqlrooms/sqlEngine';
import {DuckDbFileImportEngine} from '../infrastructure/sqlrooms/fileImportEngine';
import {V1_LIMITS, type RuntimeConfig} from '../../contracts/runtime-config';
import {WorkspaceService} from '../application/workspaceService';
import {checkedId} from '../domain/workspace';
import {BrowserWorkspaceLock} from '../infrastructure/browser/workspaceLock';
import {DexieWorkspaceRepository} from '../infrastructure/storage/workspaceRepository';
import {MemoryWorkspaceRepository} from '../infrastructure/storage/memoryRepository';
import {
  SettingsRepository,
  defaultSettings,
  settingsSchema,
  type Settings,
} from '../infrastructure/storage/settings';
import {probeCapabilities, storageEstimate} from '../infrastructure/browser/capabilities';
import {loadRuntimeConfig} from '../infrastructure/browser/runtimeConfig';
const persistent = new DexieWorkspaceRepository();
const create = (
  mode: 'persistent' | 'temporary',
  maxBytes: number,
  limits = V1_LIMITS,
  buildId = 'development',
  config?: RuntimeConfig,
) =>
  new WorkspaceService({
    mode,
    archiveCodec: new ZipArchiveCodec({
      compressedBytes: limits.archiveCompressedBytes,
      expandedBytes: limits.archiveExpandedBytes,
      entryBytes: limits.archiveEntryBytes,
      entries: limits.archiveEntries,
    }),
    ...(config
      ? {
          publicSource: new PortalAccess(
            config,
            ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname),
          ),
          createR: (sessionId: string) => new WebREngine(sessionId, config),
          rLimits: {
            timeoutMs: limits.rTimeoutMs,
            warningRows: limits.rWarningRows,
            hardRows: limits.rHardRows,
            transferBytes: limits.transferBytes,
          },
          encodePlot,
        }
      : {}),
    canCreate: mode === 'temporary' || !!navigator.locks,
    repository: mode === 'persistent' ? persistent : new MemoryWorkspaceRepository(),
    artifacts:
      mode === 'persistent' ? new OpfsArtifactStore(maxBytes) : new MemoryArtifactStore(maxBytes),
    createEngines: (sessionId, source) => {
      const runtime = new DuckDbRuntime(sessionId, limits.cancelGraceMs, limits.sqlTimeoutMs);
      return {
        files: new DuckDbFileImportEngine(maxBytes, runtime),
        sql: new SqlRoomsSqlEngine(runtime, source, buildId),
      };
    },
    budget: {
      maxExecutionMs: limits.sqlTimeoutMs,
      maxResultRows: limits.resultRows,
      maxResultBytes: limits.resultBytes,
      maxTransferBytes: limits.transferBytes,
    },
    lock:
      mode === 'persistent'
        ? new BrowserWorkspaceLock()
        : {
            acquire: async (workspaceId) => ({
              workspaceId,
              mode: 'writer',
              release: async () => {},
            }),
          },
    newId: () => checkedId(crypto.randomUUID()),
    now: () => new Date().toISOString(),
  });
export const services: {
  workspaces: WorkspaceService;
  views: ViewRepository;
  settings: Pick<SettingsRepository, 'load' | 'save'>;
  config: RuntimeConfig | undefined;
  storageEstimate: typeof storageEstimate;
  mode: 'persistent' | 'temporary';
} = {
  workspaces: create('persistent', V1_LIMITS.importFileBytes),
  views: new WorkspaceViewRepository(persistent.db),
  settings: new SettingsRepository(persistent.db),
  config: undefined,
  storageEstimate,
  mode: 'persistent',
};
export interface BootResult {
  ready: boolean;
  allowTemporary: boolean;
  allowReadOnly: boolean;
  errors: string[];
}
let initialization: Promise<BootResult> | undefined;
export function initializeServices() {
  return (initialization ??= (async () => {
    try {
      services.config = await loadRuntimeConfig();
    } catch (error) {
      return {
        ready: false,
        allowTemporary: false,
        allowReadOnly: false,
        errors: [`Konfiguration ungültig: ${String(error)}`],
      };
    }
    services.workspaces = create(
      'persistent',
      services.config.limits.importFileBytes,
      services.config.limits,
      services.config.buildId,
      services.config,
    );
    const result = await probeCapabilities();
    const persistentAvailable = result.capabilities.indexedDb && result.capabilities.opfs;
    return {
      ready: persistentAvailable && result.capabilities.webLocks,
      allowTemporary: true,
      allowReadOnly: persistentAvailable,
      errors: result.errors,
    };
  })());
}
export function useTemporaryServices() {
  if (!services.config) throw Error('Betreiberkonfiguration fehlt.');
  services.mode = 'temporary';
  services.views = new MemoryViewRepository();
  services.workspaces = create(
    'temporary',
    services.config.limits.importFileBytes,
    services.config.limits,
    services.config.buildId,
    services.config,
  );
  let settings: Settings = {...defaultSettings};
  services.settings = {
    load: async () => settings,
    save: async (value) => {
      settings = settingsSchema.parse(value);
      return settings;
    },
  };
}
