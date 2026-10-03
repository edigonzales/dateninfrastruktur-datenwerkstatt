import type {PortalTarget, TableSchema} from './domain';
/** Eigener kleiner Suchindex; KEINE Behauptung über eine vorhandene Portal-API. */
export interface CatalogIndex {
  formatVersion: 1;
  providerId: string;
  generatedAt: string;
  entries: CatalogIndexEntry[];
}
export interface CatalogIndexEntry {
  key: string;
  title: string;
  description?: string;
  target: PortalTarget | {kind: 'current-issue'; seriesId: string};
  tableId?: string;
}
export interface CatalogSelection {
  providerId: string;
  target: CatalogIndexEntry['target'];
  tableId?: string;
}
export interface ResolvedCatalogTable {
  providerId: string;
  target: PortalTarget; // current wurde in konkrete issueId aufgelöst
  tableId: string;
  title: string;
  suggestedSqlName: string;
  publicParquetUrl: string;
  canonicalUrl: string;
  observedAt: string;
  modifiedAt?: string;
  license?: string;
  schemaHint?: TableSchema;
  estimatedRows?: string;
  estimatedBytes?: number;
}
export interface CatalogAdapter {
  search(providerId: string, text: string, signal: AbortSignal): Promise<CatalogIndexEntry[]>;
  resolve(selection: CatalogSelection, signal: AbortSignal): Promise<ResolvedCatalogTable[]>;
}
