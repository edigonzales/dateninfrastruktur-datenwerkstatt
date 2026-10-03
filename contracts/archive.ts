import type {ArtifactId, WorkspaceDocument} from './domain';
/**
 * .dwproj = ZIP. Im Projekt sind Artefaktpfade portable: artifacts/<alte-id>.<ext>.
 * Der Import ignoriert diese als Zielpfade und erzeugt neue IDs und lokale Pfade.
 */
export interface ArchiveManifest {
  archiveFormat: 'datenwerkstatt';
  archiveVersion: 1;
  exportedAt: string;
  mode: 'recipe' | 'with-data';
  project: WorkspaceDocument;
  files: {artifactId: ArtifactId; entry: string; bytes: number; sha256: string}[];
  omissions: {artifactId?: ArtifactId; reason: string}[];
}
export interface ArchiveInspection {
  workspaceName: string;
  analyses: number;
  datasets: number;
  includedBytes: number;
  missingSources: number;
  containsExecutableCode: boolean;
  warnings: string[];
}
