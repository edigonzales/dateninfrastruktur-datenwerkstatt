import type {ColumnarPayload, ColumnVector, ConversionIssue} from './ports';
import type {TableSchema, ColumnSchema} from '../domain/model';
import {AppFailure} from './errors';
import {tableSchema} from '../domain/workspace';
const integerBits: Record<string, [number, boolean]> = {
  TINYINT: [8, true],
  SMALLINT: [16, true],
  INTEGER: [32, true],
  BIGINT: [64, true],
  HUGEINT: [128, true],
  UTINYINT: [8, false],
  USMALLINT: [16, false],
  UINTEGER: [32, false],
  UBIGINT: [64, false],
  UHUGEINT: [128, false],
};
export const supportedType = (type: string) =>
  !!integerBits[type] ||
  [
    'BOOLEAN',
    'FLOAT',
    'DOUBLE',
    'VARCHAR',
    'DATE',
    'TIMESTAMP',
    'TIMESTAMPTZ',
    'TIMESTAMP WITH TIME ZONE',
    'TIMESTAMP_S',
    'TIMESTAMP_MS',
    'TIMESTAMP_NS',
  ].includes(type) ||
  /^DECIMAL\(([1-9]\d?),\s*(\d+)\)$/.test(type);
export function validateExactText(value: string, type: string, column: string) {
  const bad = () => {
    throw new AppFailure(
      'TYPE_UNSUPPORTED',
      `${column}: Wert passt nicht verlustfrei in ${type}. Bitte ausdrücklich als VARCHAR übernehmen.`,
    );
  };
  const int = integerBits[type];
  if (int) {
    if (!/^-?\d+$/.test(value)) return bad();
    const n = BigInt(value),
      [bits, signed] = int;
    const min = signed ? -(1n << BigInt(bits - 1)) : 0n,
      max = (1n << BigInt(bits - (signed ? 1 : 0))) - 1n;
    if (n < min || n > max) bad();
  }
  const decimal = /^DECIMAL\((\d+),\s*(\d+)\)$/.exec(type);
  if (decimal) {
    const precision = Number(decimal[1]),
      scale = Number(decimal[2]);
    if (precision > 38 || scale > precision) bad();
    const match = /^[+-]?(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) return bad();
    const fraction = match[2] ?? '',
      whole = match[1]!.replace(/^0+/, '');
    if (whole.length > precision - scale || fraction.length > scale) bad();
  }
  if (type === 'DATE') {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
    )
      bad();
  }
  if (type.startsWith('TIMESTAMP')) {
    const match =
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(
        value,
      );
    if (!match) return bad();
    validateExactText(match[1]!, 'DATE', column);
    const precision =
      type === 'TIMESTAMP_NS' ? 9 : type === 'TIMESTAMP_MS' ? 3 : type === 'TIMESTAMP_S' ? 0 : 6;
    if (
      Number(match[2]) > 23 ||
      Number(match[3]) > 59 ||
      Number(match[4]) > 59 ||
      (match[5]?.length ?? 0) > precision
    )
      bad();
  }
}
export function fromTextRows(
  schema: TableSchema,
  rows: readonly (readonly unknown[])[],
): ColumnarPayload {
  const unsupported = schema.columns.filter((c) => !supportedType(c.logicalType));
  if (unsupported.length)
    throw new AppFailure(
      'TYPE_UNSUPPORTED',
      `Nicht für R unterstützt: ${unsupported.map((c) => `${c.name} (${c.logicalType})`).join(', ')}.`,
    );
  const issues: ConversionIssue[] = [];
  const columns: ColumnVector[] = schema.columns.map((c, index) => {
    const values = rows.map((row) => {
      const v = row[index];
      if (v !== null && typeof v !== 'string')
        throw new AppFailure('TYPE_UNSUPPORTED', `${c.name}: Ungültige Transferzelle.`);
      return v;
    });
    const validity = Uint8Array.from(values, (v) => (v === null ? 0 : 1));
    const text = values.map((v) => v ?? '');
    for (const v of values) if (v !== null) validateExactText(v, c.logicalType, c.name);
    const base = {schema: structuredClone(c), validity};
    if (c.logicalType === 'BOOLEAN')
      return {
        ...base,
        encoding: 'boolean',
        values: Uint8Array.from(values, (v) => (v === 'true' ? 1 : 0)),
      };
    if (['FLOAT', 'DOUBLE'].includes(c.logicalType))
      return {
        ...base,
        encoding: 'float64',
        values: Float64Array.from(values, (v) =>
          v === null
            ? 0
            : /^nan$/i.test(v)
              ? NaN
              : /^\+?(inf|infinity)$/i.test(v)
                ? Infinity
                : /^-(inf|infinity)$/i.test(v)
                  ? -Infinity
                  : Number(v),
        ),
      };
    const int = integerBits[c.logicalType];
    if (int) {
      const allSafe = values.every(
        (v) =>
          v === null ||
          (BigInt(v) >= BigInt(-Number.MAX_SAFE_INTEGER) &&
            BigInt(v) <= BigInt(Number.MAX_SAFE_INTEGER)),
      );
      if (allSafe) {
        const rInteger =
          int[0] <= 32 &&
          values.every((v) => v === null || (BigInt(v) > -2147483648n && BigInt(v) <= 2147483647n));
        if (rInteger)
          return {
            ...base,
            encoding: 'int32',
            values: Int32Array.from(values, (v) => (v === null ? 0 : Number(v))),
          };
        issues.push({
          id: `${c.name}:numeric`,
          column: c.name,
          kind: 'representation-change',
          message: `${c.name}: ${c.logicalType} als exakt darstellbares R numeric.`,
          requiresApproval: false,
        });
        return {
          ...base,
          encoding: 'float64',
          values: Float64Array.from(values, (v) => (v === null ? 0 : Number(v))),
        };
      }
    }
    if (c.logicalType !== 'VARCHAR' && c.logicalType !== 'DATE')
      issues.push({
        id: `${c.name}:text`,
        column: c.name,
        kind: 'representation-change',
        message: `${c.name}: ${c.logicalType} bleibt verlustfrei als Text mit Herkunftstyp.`,
        requiresApproval: false,
      });
    return {...base, encoding: 'text', values: text};
  });
  return {schema: structuredClone(schema), rowCount: rows.length, columns, issues};
}
export function payloadBytes(payload: ColumnarPayload) {
  return payload.columns.reduce(
    (sum, c) =>
      sum +
      c.validity.byteLength +
      (c.encoding === 'text'
        ? c.values.reduce((n, v) => n + new TextEncoder().encode(v).byteLength + 8, 0)
        : c.encoding === 'binary'
          ? c.values.reduce((n, v) => n + v.byteLength, 0)
          : c.values.byteLength),
    new TextEncoder().encode(JSON.stringify(payload.schema)).byteLength,
  );
}
export function validatePayload(payload: ColumnarPayload, hardRows = 100000, maxBytes = 67108864) {
  tableSchema.parse(payload.schema);
  if (
    !Number.isSafeInteger(payload.rowCount) ||
    payload.rowCount < 0 ||
    payload.rowCount > hardRows ||
    payloadBytes(payload) > maxBytes
  )
    throw new AppFailure(
      'LIMIT_EXCEEDED',
      'R-Transfer überschreitet Zeilen-/Bytebudget. Es wurde nichts gekürzt.',
    );
  if (payload.columns.length !== payload.schema.columns.length)
    throw new AppFailure('TYPE_UNSUPPORTED', 'Spaltenzahl stimmt nicht.');
  for (const [i, c] of payload.columns.entries()) {
    if (
      c.values.length !== payload.rowCount ||
      c.validity.length !== payload.rowCount ||
      c.schema.name !== payload.schema.columns[i]!.name ||
      c.schema.logicalType !== payload.schema.columns[i]!.logicalType ||
      !supportedType(c.schema.logicalType) ||
      c.encoding === 'binary'
    )
      throw new AppFailure(
        'TYPE_UNSUPPORTED',
        `Ungültige oder nicht unterstützte Spalte: ${c.schema.name}.`,
      );
    for (let row = 0; row < payload.rowCount; row++) {
      if (c.validity[row] !== 0 && c.validity[row] !== 1)
        throw new AppFailure('TYPE_UNSUPPORTED', 'Ungültige Missing-Maske.');
      if (!c.validity[row]) {
        if (!c.schema.nullable)
          throw new AppFailure(
            'TYPE_UNSUPPORTED',
            `${c.schema.name}: NULL in nicht-nullbarer Spalte.`,
          );
        continue;
      }
      validateExactText(String(c.values[row]), c.schema.logicalType, c.schema.name);
    }
  }
}
export function payloadCsv(payload: ColumnarPayload) {
  validatePayload(payload);
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const rows = [payload.schema.columns.map((c) => quote(c.name)).join(',')];
  for (let row = 0; row < payload.rowCount; row++)
    rows.push(
      payload.columns
        .map((c) =>
          !c.validity[row]
            ? ''
            : quote(
                c.encoding === 'boolean'
                  ? c.values[row]
                    ? 'true'
                    : 'false'
                  : String(c.values[row]),
              ),
        )
        .join(','),
    );
  return rows.join('\n') + '\n';
}
export function schemaColumn(name: string, logicalType: string, nullable = true): ColumnSchema {
  return {name, logicalType, nullable, roles: [], metadata: {}};
}
