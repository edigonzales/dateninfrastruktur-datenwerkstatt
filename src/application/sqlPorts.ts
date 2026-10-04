import type {SqlEngine, TableHandle} from './ports';
import type {TableSchema} from '../domain/model';
export interface ResultSqlEngine extends SqlEngine {
  readonly epoch: number;
  importColumnar(
    payload: import('./ports').ColumnarPayload,
    signal: AbortSignal,
  ): Promise<TableHandle>;
  captureParquet(
    data: ReadableStream<Uint8Array>,
    schema: TableSchema,
    rowCount: string,
    signal: AbortSignal,
  ): Promise<TableHandle>;
  exportFile(
    table: TableHandle,
    format: 'csv' | 'parquet',
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
  restore(
    data: ReadableStream<Uint8Array>,
    schema: TableSchema,
    rowCount: string,
    signal: AbortSignal,
  ): Promise<TableHandle>;
  snapshotParquet(table: TableHandle, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}
