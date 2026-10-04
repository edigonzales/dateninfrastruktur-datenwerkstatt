import {ZipArchiveCodec} from '../../src/infrastructure/archive/zip';
import {WebREngine} from '../../src/infrastructure/webr/engine';
import {encodePlot} from '../../src/infrastructure/browser/png';
import {WorkspaceService} from '../../src/application/workspaceService';
import {MemoryWorkspaceRepository} from '../../src/infrastructure/storage/memoryRepository';
import {MemoryArtifactStore} from '../../src/infrastructure/storage/artifactStore';
import {DuckDbRuntime} from '../../src/infrastructure/sqlrooms/runtime';
import {DuckDbFileImportEngine} from '../../src/infrastructure/sqlrooms/fileImportEngine';
import {SqlRoomsSqlEngine} from '../../src/infrastructure/sqlrooms/sqlEngine';
import {checkedId} from '../../src/domain/workspace';
import {V1_LIMITS} from '../../contracts/runtime-config';
export async function sqlHarness(
  timeout = 30000,
  publicSource?: import('../../src/application/catalogPorts').PublicSource,
  rConfig?: import('../../contracts/runtime-config').RuntimeConfig,
  artifactStore?: import('../../src/application/storagePorts').ManagedArtifactStore,
  rExecutionTimeoutMs?: number,
) {
  const repository = new MemoryWorkspaceRepository();
  const rEngines: WebREngine[] = [];
  const artifacts = artifactStore ?? new MemoryArtifactStore(V1_LIMITS.importFileBytes);
  const service = new WorkspaceService({
    repository,
    archiveCodec: new ZipArchiveCodec(),
    artifacts,
    ...(publicSource ? {publicSource} : {}),
    ...(rConfig
      ? {
          createR: (sessionId: string) => {
            const engine = new WebREngine(sessionId, rConfig);
            rEngines.push(engine);
            return engine;
          },
          rLimits: {
            timeoutMs: rExecutionTimeoutMs ?? rConfig.limits.rTimeoutMs,
            warningRows: rConfig.limits.rWarningRows,
            hardRows: rConfig.limits.rHardRows,
            transferBytes: rConfig.limits.transferBytes,
          },
          encodePlot,
        }
      : {}),
    mode: 'temporary',
    newId: () => checkedId(crypto.randomUUID()),
    now: () => new Date().toISOString(),
    lock: {
      acquire: async (workspaceId) => ({workspaceId, mode: 'writer', release: async () => {}}),
    },
    budget: {
      maxExecutionMs: timeout,
      maxResultRows: 100000,
      maxResultBytes: 67108864,
      maxTransferBytes: 67108864,
    },
    createEngines: (sessionId, source) => {
      const runtime = new DuckDbRuntime(sessionId);
      return {
        files: new DuckDbFileImportEngine(V1_LIMITS.importFileBytes, runtime),
        sql: new SqlRoomsSqlEngine(runtime, source, 'test'),
      };
    },
  });
  const document = await service.create('SQL Integration');
  const session = await service.open(document.workspace.id);
  return {service, session, repository, artifacts, rEngines};
}
