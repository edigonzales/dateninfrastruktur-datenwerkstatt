import {payloadCsv, validatePayload} from '../../application/rTypeCodec';
import {z} from 'zod';
import {tableFromIPC, tableToIPC} from 'apache-arrow';
import type {DatasetVersion, RuntimeFingerprint, RunId, TableSchema} from '../../domain/model';
import type {
  ArrowIpcStream,
  PageRequest,
  SqlExecutionRequest,
  TableHandle,
} from '../../application/ports';
import type {ResultSqlEngine} from '../../application/sqlPorts';
import {AppFailure} from '../../application/errors';
import {DuckDbRuntime} from './runtime';
import {prepareSelect} from './queryGuard';
export const sqlIdentifier = (s: string) => `"${s.replaceAll('"', '""')}"`;
const literal = (s: string) => `'${s.replaceAll("'", "''")}'`;
const ordinal = '__dw_ordinal';
const fresh = () => `__dw_${crypto.randomUUID().replaceAll('-', '')}`;
const columnsSql = (schema: TableSchema) =>
  schema.columns.map((c) => sqlIdentifier(c.name)).join(', ');
const description = z.object({
  column_name: z.string(),
  column_type: z.string(),
  null: z.enum(['YES', 'NO']),
});
function schemaFrom(rows: unknown[]): TableSchema {
  const used = new Set([ordinal]);
  return {
    metadata: {},
    columns: rows.map((row) => {
      const r = description.parse(row);
      let name = r.column_name;
      let n = 2;
      while (used.has(name.toLowerCase())) name = `${r.column_name}_${n++}`;
      used.add(name.toLowerCase());
      return {
        name,
        logicalType: r.column_type,
        nullable: r.null === 'YES',
        roles: [],
        metadata: {originalName: r.column_name},
      };
    }),
  };
}
/** SQLRooms' one connector also owns imports. Results are immutable private relations. */
export class SqlRoomsSqlEngine implements ResultSqlEngine {
  private handles = new Map<string, TableHandle>();
  private versions = new Map<string, string>();
  private bindings = new Map<string, string>();
  private runs = new Map<RunId, AbortController>();
  constructor(
    private readonly runtime: DuckDbRuntime,
    private readonly source: (
      version: DatasetVersion,
      signal: AbortSignal,
    ) => Promise<ReadableStream<Uint8Array>>,
    private readonly buildId: string,
  ) {
    runtime.onReset(() => {
      this.handles.clear();
      this.versions.clear();
      this.bindings.clear();
    });
  }
  get epoch() {
    return this.runtime.epoch;
  }
  initialize(signal: AbortSignal) {
    return this.runtime.operation(signal, async () => {});
  }
  async fingerprint(): Promise<RuntimeFingerprint> {
    return this.runtime.operation(new AbortController().signal, async (_room, c) => ({
      appBuildId: this.buildId,
      engineId: 'duckdb-local',
      engineVersion: z.string().parse((await c.query('SELECT version()')).getChildAt(0)?.get(0)),
      transferCodecVersion: '1',
      timeZone: 'UTC',
    }));
  }
  async registerDataset(version: DatasetVersion, name: string, signal: AbortSignal) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name) || name.startsWith('__dw_'))
      throw new AppFailure('VALIDATION_FAILED', 'Ungültiger SQL-Name.');
    await this.runtime.operation(signal, async (room, c) => {
      let relation = this.versions.get(version.id);
      // Revalidate public bytes even when this session already holds a materialized relation.
      const publicData =
        version.backing.kind === 'public-parquet' ? await this.source(version, signal) : undefined;
      if (relation && publicData) await publicData.cancel();
      if (!relation) {
        relation = fresh();
        const file = `${relation}.parquet`;
        const data = await new Response(
          publicData ?? (await this.source(version, signal)),
        ).arrayBuffer();
        signal.throwIfAborted();
        await room.connector.getDb().registerFileBuffer(file, new Uint8Array(data));
        try {
          await c.query(
            `CREATE TEMP TABLE ${sqlIdentifier(relation)} AS SELECT * FROM read_parquet(${literal(file)})`,
          );
        } finally {
          if (this.runtime.isCurrent(room)) await room.connector.getDb().dropFile(file);
        }
        this.versions.set(version.id, relation);
      }
      await c.query('CREATE SCHEMA IF NOT EXISTS data');
      await c.query(
        `CREATE OR REPLACE VIEW data.${sqlIdentifier(name)} AS SELECT * FROM ${sqlIdentifier(relation)}`,
      );
      this.bindings.set(name, version.id);
    });
  }
  async execute(request: SqlExecutionRequest) {
    const controller = new AbortController();
    const signal = AbortSignal.any([request.signal, controller.signal]);
    this.runs.set(request.runId, controller);
    try {
      return await this.runtime.operation(signal, async (room, c) => {
        const names = new Set(
          request.snapshot.resolvedInputs.map((r) => r.bindingName.toLowerCase()),
        );
        for (const name of this.bindings.keys())
          if (!names.has(name)) {
            await c.query(`DROP VIEW IF EXISTS data.${sqlIdentifier(name)}`);
            this.bindings.delete(name);
          }
        await c.query('CREATE SCHEMA IF NOT EXISTS data');
        await c.query("SET search_path='data,main'");
        const bound = await prepareSelect(
          c,
          request.snapshot.code,
          names,
          request.snapshot.parameters,
        );
        const describe = await c.prepare(`DESCRIBE ${bound.code}`);
        let schema: TableSchema;
        try {
          schema = schemaFrom(
            (await describe.query(...bound.values)).toArray().map((r) => r.toJSON() as unknown),
          );
        } finally {
          if (this.runtime.isCurrent(room)) await describe.close();
        }
        if (!schema.columns.length)
          throw new AppFailure('SQL_ERROR', 'Resultat enthält keine Spalten.');
        const max = request.budget.maxResultRows;
        if (!Number.isSafeInteger(max) || max < 1 || max > 100000)
          throw new AppFailure('LIMIT_EXCEEDED', 'Ungültiges Zeilenbudget.');
        const key = fresh();
        const executedCode = `SELECT row_number() OVER () AS ${sqlIdentifier(ordinal)}, t.* FROM (${bound.code}) AS t(${columnsSql(schema)}) LIMIT ${max + 1}`;
        let success = false;
        try {
          const statement = await c.prepare(
            `CREATE TEMP TABLE ${sqlIdentifier(key)} AS ${executedCode}`,
          );
          try {
            await statement.query(...bound.values);
          } finally {
            if (this.runtime.isCurrent(room)) await statement.close();
          }
          signal.throwIfAborted();
          const count = z
            .string()
            .parse(
              (await c.query(`SELECT count(*)::VARCHAR FROM ${sqlIdentifier(key)}`))
                .getChildAt(0)
                ?.get(0),
            );
          const limited = BigInt(count) > BigInt(max);
          if (limited)
            await c.query(
              `DELETE FROM ${sqlIdentifier(key)} WHERE ${sqlIdentifier(ordinal)} > ${max}`,
            );
          // Bounded Arrow transfer, never a JSON copy of the whole result into React.
          const table = await c.query(`SELECT ${columnsSql(schema)} FROM ${sqlIdentifier(key)}`);
          const bytes = table.batches.reduce((sum, batch) => sum + batch.data.byteLength, 0);
          if (bytes > request.budget.maxResultBytes)
            throw new AppFailure(
              'LIMIT_EXCEEDED',
              `Resultat benötigt ${bytes} Bytes; Budget ${request.budget.maxResultBytes}.`,
            );
          signal.throwIfAborted();
          const handle = this.remember(key, schema, limited ? String(max) : count);
          success = true;
          const warnings = schema.columns
            .filter((col) => col.name !== col.metadata.originalName)
            .map((col) => `Spalte ${col.metadata.originalName} heisst im Resultat ${col.name}.`);
          return {table: handle, executedCode, limited, warnings};
        } finally {
          if (!success && this.runtime.isCurrent(room))
            await c.query(`DROP TABLE IF EXISTS ${sqlIdentifier(key)}`).catch(() => {});
        }
      });
    } catch (error) {
      if (error instanceof AppFailure) throw error;
      throw new AppFailure(
        signal.aborted ? 'CANCELLED' : 'SQL_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.runs.delete(request.runId);
    }
  }
  private remember(key: string, schema: TableSchema, rowCount: string): TableHandle {
    const handle = {
      sessionId: this.runtime.sessionId,
      engineEpoch: this.epoch,
      key,
      schema,
      rowCount,
    };
    this.handles.set(key, handle);
    return handle;
  }
  private require(handle: TableHandle) {
    if (
      handle.sessionId !== this.runtime.sessionId ||
      handle.engineEpoch !== this.epoch ||
      this.handles.get(handle.key) !== handle
    )
      throw new AppFailure(
        'RUNTIME_RESET',
        'Resultat ist nicht mehr in dieser SQL-Sitzung verfügbar.',
      );
    return sqlIdentifier(handle.key);
  }
  async readPage(table: TableHandle, request: PageRequest, signal: AbortSignal) {
    if (
      !Number.isSafeInteger(request.offset) ||
      request.offset < 0 ||
      !Number.isSafeInteger(request.size) ||
      request.size < 1 ||
      request.size > 500
    )
      throw new AppFailure('VALIDATION_FAILED', 'Seite erlaubt maximal 500 Zeilen.');
    const order = request.sort.map((s) => {
      if (
        !table.schema.columns.some((c) => c.name === s.column) ||
        !['asc', 'desc'].includes(s.direction)
      )
        throw new AppFailure('VALIDATION_FAILED', 'Ungültige Sortierung.');
      return `r.${sqlIdentifier(s.column)} ${s.direction.toUpperCase()} NULLS LAST`;
    });
    order.push(`r.${sqlIdentifier(ordinal)}`);
    return this.runtime.operation(signal, async (_room, c) => {
      const relation = this.require(table);
      // Text only for display: DuckDB does numeric sorting before this exact representation.
      const projection = table.schema.columns
        .map((col) => `CAST(${sqlIdentifier(col.name)} AS VARCHAR) AS ${sqlIdentifier(col.name)}`)
        .join(',');
      const page = await c.query(
        `SELECT ${projection} FROM ${relation} AS r ORDER BY ${order.join(',')} LIMIT ${request.size} OFFSET ${request.offset}`,
      );
      return {
        totalRows: table.rowCount,
        rows: page.toArray().map((row) =>
          table.schema.columns.map((col) => {
            const data = z.record(z.string(), z.unknown()).parse(row.toJSON());
            return data[col.name];
          }),
        ),
      };
    });
  }
  private async file(
    table: TableHandle,
    format: 'csv' | 'parquet',
    internal: boolean,
    signal: AbortSignal,
  ) {
    return this.runtime.operation(signal, async (room, c) => {
      const relation = this.require(table);
      const file = `${fresh()}.${format}`;
      try {
        await c.query(
          `COPY (SELECT ${internal ? '*' : columnsSql(table.schema)} FROM ${relation} ORDER BY ${sqlIdentifier(ordinal)}) TO ${literal(file)} (FORMAT ${format.toUpperCase()}${format === 'csv' ? ", HEADER true, NULL '\\N', FORCE_QUOTE *" : ''})`,
        );
        const bytes = await room.connector.getDb().copyFileToBuffer(file);
        return new Blob([new Uint8Array(bytes)]).stream();
      } finally {
        if (this.runtime.isCurrent(room))
          await room.connector
            .getDb()
            .dropFile(file)
            .catch(() => {});
      }
    });
  }
  exportFile(table: TableHandle, format: 'csv' | 'parquet', signal: AbortSignal) {
    return this.file(table, format, false, signal);
  }
  writeParquet(table: TableHandle, signal: AbortSignal) {
    return this.file(table, 'parquet', false, signal);
  }
  snapshotParquet(table: TableHandle, signal: AbortSignal) {
    return this.file(table, 'parquet', true, signal);
  }
  async restore(
    data: ReadableStream<Uint8Array>,
    schema: TableSchema,
    rowCount: string,
    signal: AbortSignal,
  ) {
    return this.runtime.operation(signal, async (room, c) => {
      const key = fresh();
      const file = `${key}.parquet`;
      await room.connector
        .getDb()
        .registerFileBuffer(file, new Uint8Array(await new Response(data).arrayBuffer()));
      let success = false;
      try {
        await c.query(
          `CREATE TEMP TABLE ${sqlIdentifier(key)} AS SELECT * FROM read_parquet(${literal(file)})`,
        );
        const checks = await c.query(
          `SELECT count(*)::VARCHAR AS n, count(DISTINCT ${sqlIdentifier(ordinal)})::VARCHAR AS unique_n, min(${sqlIdentifier(ordinal)})::VARCHAR AS first_n, max(${sqlIdentifier(ordinal)})::VARCHAR AS last_n FROM ${sqlIdentifier(key)}`,
        );
        const row = z
          .object({
            n: z.string(),
            unique_n: z.string(),
            first_n: z.string().nullable(),
            last_n: z.string().nullable(),
          })
          .parse(checks.get(0)?.toJSON());
        if (
          row.n !== rowCount ||
          row.unique_n !== rowCount ||
          (rowCount !== '0' && (row.first_n !== '1' || row.last_n !== rowCount))
        )
          throw new AppFailure('ARTIFACT_CORRUPT', 'Resultatordnung oder Umfang ungültig.');
        const actual = (
          await c.query(`DESCRIBE SELECT ${columnsSql(schema)} FROM ${sqlIdentifier(key)}`)
        )
          .toArray()
          .map((r) => description.parse(r.toJSON()));
        if (
          actual.length !== schema.columns.length ||
          actual.some(
            (col, i) =>
              col.column_name !== schema.columns[i]!.name ||
              col.column_type !== schema.columns[i]!.logicalType,
          )
        )
          throw new AppFailure('ARTIFACT_CORRUPT', 'Resultatschema stimmt nicht überein.');
        success = true;
        return this.remember(key, schema, rowCount);
      } finally {
        if (this.runtime.isCurrent(room)) {
          await room.connector.getDb().dropFile(file);
          if (!success) await c.query(`DROP TABLE IF EXISTS ${sqlIdentifier(key)}`);
        }
      }
    });
  }
  async importColumnar(
    payload: import('../../application/ports').ColumnarPayload,
    signal: AbortSignal,
  ) {
    validatePayload(payload);
    const bytes = new TextEncoder().encode(payloadCsv(payload));
    if (bytes.byteLength > 67108864)
      throw new AppFailure('LIMIT_EXCEEDED', 'Transfer überschreitet Bytebudget.');
    return this.runtime.operation(signal, async (room, c) => {
      const key = fresh(),
        file = `${key}.csv`;
      let success = false;
      try {
        await room.connector.getDb().registerFileBuffer(file, bytes);
        const types = payload.schema.columns
          .map((col) => `${literal(col.name)}:${literal(col.logicalType)}`)
          .join(',');
        await c.query(
          `CREATE TEMP TABLE ${sqlIdentifier(key)} AS SELECT row_number() OVER () AS ${sqlIdentifier(ordinal)}, * FROM read_csv(${literal(file)},header=true,delim=',',quote='"',escape='"',nullstr='',allow_quoted_nulls=false,strict_mode=true,ignore_errors=false,parallel=false,auto_detect=false,columns={${types}})`,
        );
        const count = String(
          (await c.query(`SELECT count(*) AS n FROM ${sqlIdentifier(key)}`)).getChildAt(0)?.get(0),
        );
        if (count !== String(payload.rowCount))
          throw new AppFailure('TYPE_UNSUPPORTED', 'Rücktransfer hat andere Zeilenzahl.');
        success = true;
        return this.remember(key, payload.schema, count);
      } finally {
        if (this.runtime.isCurrent(room)) {
          await room.connector.getDb().dropFile(file);
          if (!success) await c.query(`DROP TABLE IF EXISTS ${sqlIdentifier(key)}`);
        }
      }
    });
  }
  async captureParquet(
    data: ReadableStream<Uint8Array>,
    schema: TableSchema,
    rowCount: string,
    signal: AbortSignal,
  ) {
    if (BigInt(rowCount) > 100000n)
      throw new AppFailure('LIMIT_EXCEEDED', 'Mehr als 100000 Zeilen.');
    return this.runtime.operation(signal, async (room, c) => {
      const key = fresh(),
        file = `${key}.parquet`;
      let success = false;
      try {
        await room.connector
          .getDb()
          .registerFileBuffer(file, new Uint8Array(await new Response(data).arrayBuffer()));
        await c.query(
          `CREATE TEMP TABLE ${sqlIdentifier(key)} AS SELECT row_number() OVER () AS ${sqlIdentifier(ordinal)}, * FROM read_parquet(${literal(file)}) LIMIT 100001`,
        );
        const count = String(
          (await c.query(`SELECT count(*) AS n FROM ${sqlIdentifier(key)}`)).getChildAt(0)?.get(0),
        );
        if (count !== rowCount)
          throw new AppFailure('SOURCE_CHANGED', 'Zeilenzahl der Quelle stimmt nicht.');
        success = true;
        return this.remember(key, schema, count);
      } finally {
        if (this.runtime.isCurrent(room)) {
          await room.connector.getDb().dropFile(file);
          if (!success) await c.query(`DROP TABLE IF EXISTS ${sqlIdentifier(key)}`);
        }
      }
    });
  }
  async exportArrow(table: TableHandle, signal: AbortSignal): Promise<ArrowIpcStream> {
    const bytes = await this.runtime.operation(signal, async (_room, c) =>
      tableToIPC(
        await c.query(
          `SELECT ${columnsSql(table.schema)} FROM ${this.require(table)} ORDER BY ${sqlIdentifier(ordinal)}`,
        ),
      ),
    );
    return {
      schema: table.schema,
      chunks: (async function* () {
        yield bytes;
      })(),
    };
  }
  async importArrow(data: ArrowIpcStream, signal: AbortSignal) {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let length = 0;
    for await (const chunk of data.chunks) {
      signal.throwIfAborted();
      length += chunk.byteLength;
      if (length > 67108864)
        throw new AppFailure('LIMIT_EXCEEDED', 'Arrow-Transfer überschreitet 64 MiB.');
      chunks.push(new Uint8Array(chunk));
    }
    const table = tableFromIPC(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    if (table.numRows > 100000)
      throw new AppFailure('LIMIT_EXCEEDED', 'Arrow-Transfer überschreitet 100000 Zeilen.');
    return this.runtime.operation(signal, async (room, c) => {
      const key = fresh();
      const stage = fresh();
      try {
        await c.insertArrowTable(table, {name: stage});
        await c.query(
          `CREATE TEMP TABLE ${sqlIdentifier(key)} AS SELECT row_number() OVER () AS ${sqlIdentifier(ordinal)}, * FROM ${sqlIdentifier(stage)}`,
        );
        return this.remember(key, data.schema, String(table.numRows));
      } finally {
        if (this.runtime.isCurrent(room))
          await c.query(`DROP TABLE IF EXISTS ${sqlIdentifier(stage)}`);
      }
    });
  }
  async release(table: TableHandle) {
    if (!this.handles.has(table.key) || table.engineEpoch !== this.epoch) return;
    await this.runtime.operation(new AbortController().signal, async (_room, c) => {
      const relation = this.require(table);
      this.handles.delete(table.key);
      await c.query(`DROP TABLE IF EXISTS ${relation}`);
    });
  }
  async cancel(runId: RunId) {
    const controller = this.runs.get(runId);
    if (!controller) return 'already-settled' as const;
    const epoch = this.epoch;
    controller.abort();
    await this.runtime.operation(new AbortController().signal, async () => {});
    return this.epoch === epoch ? ('interrupted' as const) : ('runtime-reset' as const);
  }
  async dispose() {
    await this.runtime.dispose();
    this.handles.clear();
  }
}
