import type {DatasetVersion} from '../domain/model';
export type {CatalogAdapter, CatalogSelection, ResolvedCatalogTable} from '../../contracts/catalog';
export interface PublicFile {
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
  etag?: string;
  lastModified?: string;
}
export interface PublicSource {
  fetch(url: string, signal: AbortSignal, expected?: DatasetVersion): Promise<PublicFile>;
}
