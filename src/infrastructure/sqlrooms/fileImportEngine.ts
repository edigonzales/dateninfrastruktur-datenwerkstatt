import {z} from 'zod';
import type {CsvImportOptions, TableSchema} from '../../domain/model';
import {tableSchema} from '../../domain/workspace';
import type {FileImportEngine, ImportFile, ImportPreview} from '../../application/importPorts';
import {AppFailure} from '../../application/errors';
import {DuckDbRuntime} from './runtime';
import type {AsyncDuckDBConnection} from '@duckdb/duckdb-wasm';
const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
export const defaultCsvOptions = (): CsvImportOptions => ({
  encoding: 'utf-8',
  delimiter: ';',
  header: true,
  quote: '"',
  escape: '"',
  decimalSeparator: '.',
  nullStrings: [],
  emptyStringIsNull: true,
  columns: [],
});
const importOptions = z
  .strictObject({
    encoding: z.literal('utf-8'),
    delimiter: z.enum([',', ';', '\t', '|']),
    header: z.boolean(),
    quote: z.literal('"'),
    escape: z.literal('"'),
    decimalSeparator: z.enum(['.', ',']),
    nullStrings: z.array(z.string()),
    emptyStringIsNull: z.boolean(),
    columns: z.array(
      z.strictObject({
        sourceIndex: z.number().int().nonnegative(),
        name: z.string().min(1),
        logicalType: z
          .string()
          .regex(
            /^(VARCHAR|BOOLEAN|TINYINT|SMALLINT|INTEGER|BIGINT|UBIGINT|HUGEINT|DOUBLE|FLOAT|DATE|TIMESTAMP|TIMESTAMPTZ|DECIMAL\((?:[1-9]|[12][0-9]|3[0-8]),(?:[0-9]|[12][0-9]|3[0-8])\))$/,
          ),
      }),
    ),
  })
  .refine(
    (o) => new Set(o.columns.map((c) => c.name)).size === o.columns.length,
    'Doppelte Spaltennamen.',
  )
  .refine(
    (o) => o.columns.every((c, i) => c.sourceIndex === i),
    'Die Quellspalten dürfen nicht still umgeordnet werden.',
  );
function csvSource(fileName: string, options: CsvImportOptions, textOnly: boolean) {
  const o = importOptions.parse(options);
  const nulls = [...new Set([...o.nullStrings, ...(o.emptyStringIsNull ? [''] : [])])];
  const common = `delim=${lit(o.delimiter)}, header=${o.header}, quote='"', escape='"', decimal_separator=${lit(o.decimalSeparator)}, nullstr=[${nulls.map(lit).join(',')}], allow_quoted_nulls=false, strict_mode=true, ignore_errors=false, parallel=false`;
  const columns =
    o.columns.length && !textOnly
      ? `auto_detect=false, columns={${o.columns.map((c) => `${lit(c.name)}:${lit(c.logicalType)}`).join(',')}}`
      : 'auto_detect=true, all_varchar=true, sample_size=200';
  return `read_csv(${lit(fileName)}, ${common}, ${columns})`;
}
function inferType(name: string, values: unknown[], decimal: string) {
  const present = values.filter((v): v is string => typeof v === 'string' && v !== '');
  if (
    !present.length ||
    /(^id$|_id$|code|bfs)/i.test(name) ||
    present.some((v) => /^-?0[0-9]/.test(v))
  )
    return 'VARCHAR';
  if (present.every((v) => /^-?[0-9]+$/.test(v))) {
    const integers = present.map((v) => BigInt(v));
    if (integers.every((v) => v >= -2147483648n && v <= 2147483647n)) return 'INTEGER';
    if (integers.every((v) => v >= -9223372036854775808n && v <= 9223372036854775807n))
      return 'BIGINT';
    return 'VARCHAR';
  }
  if (present.every((v) => /^(true|false)$/i.test(v))) return 'BOOLEAN';
  if (present.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'DATE';
  const fixed = decimal === '.' ? /^-?[0-9]+\.[0-9]+$/ : /^-?[0-9]+,[0-9]+$/;
  if (present.every((v) => fixed.test(v))) {
    const scale = Math.max(...present.map((v) => v.split(decimal)[1]!.length));
    if (scale <= 18 && present.every((v) => v.replace(/[-.,]/g, '').length <= 38))
      return `DECIMAL(38,${scale})`;
  }
  return 'VARCHAR';
}
interface Candidate {
  fileName: string;
  format: 'csv' | 'parquet';
  options?: CsvImportOptions;
  schema: TableSchema;
}
/** Session-owned connector. Panels use this port and never construct workers. */
export class DuckDbFileImportEngine implements FileImportEngine {
  private candidates = new Map<string, Candidate>();
  constructor(
    private readonly maxBytes: number,
    private readonly runtime = new DuckDbRuntime(),
  ) {
    runtime.onReset(() => this.candidates.clear());
  }
  private operation: DuckDbRuntime['operation'] = (signal, work) =>
    this.runtime.operation(signal, work);
  private async schema(connection: AsyncDuckDBConnection, source: string): Promise<TableSchema> {
    const rows = (await connection.query(`DESCRIBE SELECT * FROM ${source}`)).toArray();
    const columns = rows.map((row) => {
      const value: unknown = row.toJSON();
      const parsed = z
        .object({column_name: z.string(), column_type: z.string(), null: z.enum(['YES', 'NO'])})
        .parse(value);
      return {
        name: parsed.column_name,
        logicalType: parsed.column_type,
        nullable: parsed.null === 'YES',
        roles: [],
        metadata: {},
      };
    });
    if (columns.length > 200)
      throw new AppFailure('LIMIT_EXCEEDED', 'Vorschau erlaubt maximal 200 Spalten.');
    const schema: TableSchema = {columns, metadata: {}};
    tableSchema.parse(schema);
    return schema;
  }
  private async rows(connection: AsyncDuckDBConnection, source: string, schema: TableSchema) {
    // Display-only text conversion preserves full decimal/int64 spelling. Source remains typed.
    const result = await connection.query(
      `SELECT ${schema.columns.map((c) => `CAST(${ident(c.name)} AS VARCHAR) AS ${ident(c.name)}`).join(',')} FROM ${source} LIMIT 200`,
    );
    return result.toArray().map((row) => {
      const values = z.record(z.string(), z.unknown()).parse(row.toJSON());
      return schema.columns.map((column) => values[column.name]);
    });
  }
  async preview(
    file: ImportFile,
    format: 'csv' | 'parquet',
    options: CsvImportOptions | undefined,
    signal: AbortSignal,
  ): Promise<ImportPreview> {
    if (!Number.isSafeInteger(file.size) || file.size <= 0)
      throw new AppFailure('IMPORT_INVALID', 'Leere oder ungültige Datei.');
    if (file.size > this.maxBytes)
      throw new AppFailure(
        'LIMIT_EXCEEDED',
        `Datei überschreitet das Importlimit von ${this.maxBytes} Bytes.`,
      );
    const key = crypto.randomUUID();
    return this.operation(signal, async (room, connection) => {
      const fileName = `__dw_import_${key}.${format}`;
      try {
        const reader = file.stream().getReader();
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let length = 0;
        const decoder = format === 'csv' ? new TextDecoder('utf-8', {fatal: true}) : undefined;
        try {
          for (;;) {
            signal.throwIfAborted();
            const next = await reader.read();
            if (next.done) break;
            length += next.value.byteLength;
            if (length > this.maxBytes)
              throw new AppFailure('LIMIT_EXCEEDED', 'Importlimit überschritten.');
            if (decoder) {
              const text = decoder.decode(next.value, {stream: true});
              if (text.includes('\0'))
                throw new AppFailure('IMPORT_INVALID', 'CSV enthält Nullbytes.');
            }
            chunks.push(new Uint8Array(next.value));
          }
          decoder?.decode();
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        const blob = new Blob(chunks);
        await room.connector
          .getDb()
          .registerFileBuffer(fileName, new Uint8Array(await blob.arrayBuffer()));
        const csv =
          format === 'csv' ? importOptions.parse(options ?? defaultCsvOptions()) : undefined;
        const source = csv
          ? csvSource(fileName, csv, csv.columns.length === 0)
          : `read_parquet(${lit(fileName)})`;
        let schema = await this.schema(connection, source);
        const rows = await this.rows(connection, source, schema);
        if (csv && csv.columns.length === 0) {
          schema = {
            ...schema,
            columns: schema.columns.map((c, i) => ({
              ...c,
              logicalType: inferType(
                c.name,
                rows.map((r) => r[i]),
                csv.decimalSeparator,
              ),
            })),
          };
          csv.columns = schema.columns.map((c, sourceIndex) => ({
            sourceIndex,
            name: c.name,
            logicalType: c.logicalType,
          }));
        }
        this.candidates.set(key, {fileName, format, schema, ...(csv ? {options: csv} : {})});
        return {key, schema, rows, ...(csv ? {csvOptions: csv} : {})};
      } catch (error) {
        await room.connector
          .getDb()
          .dropFile(fileName)
          .catch(() => {});
        if (error instanceof AppFailure) throw error;
        throw new AppFailure(
          'IMPORT_INVALID',
          `Dateivorschau fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
  async prepare(key: string, signal: AbortSignal) {
    return this.operation(signal, async (room, connection) => {
      const candidate = this.candidates.get(key);
      if (!candidate)
        throw new AppFailure('RUNTIME_RESET', 'Vorschau ist nicht mehr gültig. Bitte neu prüfen.');
      const relation = `__dw_stage_${key.replaceAll('-', '')}`;
      const output = `${relation}.parquet`;
      const source = candidate.options
        ? csvSource(candidate.fileName, candidate.options, false)
        : `read_parquet(${lit(candidate.fileName)})`;
      try {
        // Full strict parse happens before any document mutation, including rows beyond preview.
        await connection.query(`CREATE TEMP TABLE ${ident(relation)} AS SELECT * FROM ${source}`);
        const count = (
          await connection.query(`SELECT count(*)::VARCHAR AS n FROM ${ident(relation)}`)
        )
          .getChild('n')
          ?.get(0) as unknown;
        const rowCount = z
          .string()
          .regex(/^(0|[1-9][0-9]*)$/)
          .parse(count);
        let bytes: Uint8Array;
        if (candidate.format === 'parquet')
          bytes = await room.connector.getDb().copyFileToBuffer(candidate.fileName);
        else {
          await connection.query(`COPY ${ident(relation)} TO ${lit(output)} (FORMAT PARQUET)`);
          bytes = await room.connector.getDb().copyFileToBuffer(output);
        }
        if (bytes.byteLength > this.maxBytes)
          throw new AppFailure(
            'LIMIT_EXCEEDED',
            'Kanonische Datei überschreitet das Artefaktlimit.',
          );
        const schema = await this.schema(connection, ident(relation));
        return {schema, rowCount, data: new Blob([new Uint8Array(bytes)]).stream()};
      } finally {
        if (this.runtime.isCurrent(room)) {
          await connection.query(`DROP TABLE IF EXISTS ${ident(relation)}`).catch(() => {});
          await room.connector
            .getDb()
            .dropFile(output)
            .catch(() => {});
        }
      }
    });
  }
  async release(key: string) {
    const candidate = this.candidates.get(key);
    this.candidates.delete(key);
    if (candidate)
      await this.operation(new AbortController().signal, async (room) => {
        await room.connector
          .getDb()
          .dropFile(candidate.fileName)
          .catch(() => {});
      });
  }

  async inspect(data: ReadableStream<Uint8Array>, signal: AbortSignal) {
    // A bounded source was already verified by ArtifactStore; preview retains no document bytes.
    const blob = await new Response(data).blob();
    return this.preview(
      {name: 'saved.parquet', size: blob.size, stream: () => blob.stream()},
      'parquet',
      undefined,
      signal,
    );
  }
  async dispose() {
    this.candidates.clear();
    await this.runtime.dispose();
  }
}
