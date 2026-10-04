import {describe, it, expect} from 'vitest';
import {
  fromTextRows,
  validatePayload,
  schemaColumn,
  payloadCsv,
  validateExactText,
} from '../../src/application/rTypeCodec';
describe('P5 columnar exactness contract', () => {
  it('does not confuse NULL, valid NaN, infinity, identifier or int32 R-NA sentinel', () => {
    const payload = fromTextRows(
      {
        metadata: {},
        columns: [
          schemaColumn('x', 'DOUBLE'),
          schemaColumn('id', 'VARCHAR'),
          schemaColumn('int', 'INTEGER'),
        ],
      },
      [
        [null, '001', '-2147483648'],
        ['nan', '', '2147483647'],
        ['inf', 'NULL', null],
        ['-inf', 'ü', '0'],
      ],
    );
    expect(payload.columns[0]?.validity).toEqual(new Uint8Array([0, 1, 1, 1]));
    expect(payload.columns[0]?.values).toEqual(new Float64Array([0, NaN, Infinity, -Infinity]));
    expect(payload.columns[2]?.encoding).toBe('float64');
    expect(payloadCsv(payload)).toContain('"001","-2147483648"');
  });
  it('rejects decimal overflow/rounding, timestamp precision loss and unsupported columns', () => {
    for (const value of ['1.00001', '100000000000000.0000', 'NaN'])
      expect(() => validateExactText(value, 'DECIMAL(18,4)', 'betrag')).toThrow();
    expect(() => validateExactText('2026-01-01 00:00:00.123456789', 'TIMESTAMP', 'zeit')).toThrow();
    expect(() =>
      fromTextRows(
        {
          metadata: {},
          columns: [schemaColumn('s', 'STRUCT(x INTEGER)'), schemaColumn('b', 'BLOB')],
        },
        [],
      ),
    ).toThrow(/s.*b/);
  });
  it('enforces actual byte and full-row budgets, never a partial payload', () => {
    const payload = fromTextRows({metadata: {}, columns: [schemaColumn('x', 'VARCHAR')]}, [
      ['abcdef'],
    ]);
    expect(() => validatePayload(payload, 0)).toThrow(/Budget|budget/);
    expect(() => validatePayload(payload, 100, 1)).toThrow(/Budget|budget/);
  });
});
