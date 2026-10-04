import type {CsvImportOptions, TableSchema} from '../domain/model';
/** Runtime-only input. File/Blob bytes never enter the workspace document. */
export interface ImportFile {
  name: string;
  size: number;
  stream(): ReadableStream<Uint8Array>;
}
export interface ImportPreview {
  schema: TableSchema;
  rows: readonly (readonly unknown[])[];
  csvOptions?: CsvImportOptions;
  key: string;
  sourceSha256?: string;
}
export interface PreparedImport {
  schema: TableSchema;
  rowCount: string;
  data: ReadableStream<Uint8Array>;
}
export interface FileImportEngine {
  preview(
    file: ImportFile,
    format: 'csv' | 'parquet',
    options: CsvImportOptions | undefined,
    signal: AbortSignal,
  ): Promise<ImportPreview>;
  prepare(key: string, signal: AbortSignal): Promise<PreparedImport>;
  release(key: string): Promise<void>;
  inspect(data: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<ImportPreview>;
  dispose(): Promise<void>;
}
