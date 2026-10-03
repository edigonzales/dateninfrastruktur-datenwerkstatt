/** Betreiberkonfiguration, nie aus einem Workspace-Archiv übernehmen. Keine Secrets. */
export interface RuntimeConfig {
  formatVersion: 1;
  appBasePath: string;
  buildId: string;
  portalProviders: {id: string; title: string; baseUrl: string; indexUrl?: string}[];
  allowedDataOrigins: string[];
  runtimes: {
    webRBaseUrl: string;
    webRPackageRepoUrl: string;
    webRChannel: 'post-message' | 'auto';
    packageLockUrl: string;
  };
  limits: {
    importFileBytes: number;
    resultRows: number;
    resultBytes: number;
    sqlTimeoutMs: number;
    rTimeoutMs: number;
    cancelGraceMs: number;
    rWarningRows: number;
    rHardRows: number;
    transferBytes: number;
    archiveCompressedBytes: number;
    archiveExpandedBytes: number;
    archiveEntryBytes: number;
    archiveEntries: number;
  };
}
export const V1_LIMITS: RuntimeConfig['limits'] = {
  importFileBytes: 134_217_728,
  resultRows: 100_000,
  resultBytes: 67_108_864,
  sqlTimeoutMs: 30_000,
  rTimeoutMs: 60_000,
  cancelGraceMs: 2_000,
  rWarningRows: 10_000,
  rHardRows: 100_000,
  transferBytes: 67_108_864,
  archiveCompressedBytes: 134_217_728,
  archiveExpandedBytes: 536_870_912,
  archiveEntryBytes: 134_217_728,
  archiveEntries: 4_096,
};
