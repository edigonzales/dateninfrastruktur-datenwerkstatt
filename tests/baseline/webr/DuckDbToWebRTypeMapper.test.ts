import {describe, expect, it} from 'vitest';
import {mapDuckDbColumnToR, normalizeDuckDbValueForR, type DuckDbColumnForR} from './DuckDbToWebRTypeMapper';

function measureColumn(name: string): DuckDbColumnForR {
  return {name, duckdbType: 'BIGINT', nullable: true, roles: ['measure']};
}

describe('mapDuckDbColumnToR', () => {
  it('keeps risky DuckDB types lossless as character', () => {
    expect(mapDuckDbColumnToR({name: 'id', duckdbType: 'BIGINT', nullable: false, roles: ['identifier']})).toMatchObject({
      rType: 'character',
      warning: expect.stringContaining('Identifier')
    });
    expect(mapDuckDbColumnToR({name: 'betrag', duckdbType: 'DECIMAL(18, 4)', nullable: true, roles: ['measure']})).toMatchObject({
      rType: 'character',
      warning: expect.stringContaining('DECIMAL')
    });
    expect(mapDuckDbColumnToR({name: 'geom', duckdbType: 'GEOMETRY', nullable: true, roles: ['geometry']})).toMatchObject({
      rType: 'character',
      warning: expect.stringContaining('Geometrien')
    });
  });

  it('maps common scalar types to conservative R types', () => {
    expect(mapDuckDbColumnToR({name: 'anzahl', duckdbType: 'INTEGER', nullable: false, roles: ['measure']}).rType).toBe('integer');
    expect(mapDuckDbColumnToR({name: 'nitrat', duckdbType: 'DOUBLE', nullable: true, roles: ['measure']}).rType).toBe('numeric');
    expect(mapDuckDbColumnToR({name: 'aktiv', duckdbType: 'BOOLEAN', nullable: true, roles: ['unknown']}).rType).toBe('logical');
    expect(mapDuckDbColumnToR({name: 'datum', duckdbType: 'DATE', nullable: true, roles: ['date']}).rType).toBe('Date');
    expect(mapDuckDbColumnToR({name: 'ts', duckdbType: 'TIMESTAMP', nullable: true, roles: ['date']}).rType).toBe('POSIXct');
  });

  it('keeps wide integers without value knowledge lossless as character', () => {
    expect(mapDuckDbColumnToR({name: 'jahrgang', duckdbType: 'BIGINT', nullable: true, roles: ['measure']})).toMatchObject({
      rType: 'character',
      warning: expect.stringContaining('64-bit Integer')
    });
  });

  it('uses the smallest lossless R type for wide integer columns with known values', () => {
    const column = measureColumn('jahrgang');
    expect(mapDuckDbColumnToR(column, [2024n, 2025n, null])).toEqual({rType: 'integer'});
    expect(mapDuckDbColumnToR(column, [2024, 2025, 2026])).toEqual({rType: 'integer'});
    expect(mapDuckDbColumnToR(column, ['2024', '2025'])).toEqual({rType: 'integer'});
    expect(mapDuckDbColumnToR(column, [])).toEqual({rType: 'integer'});
    expect(mapDuckDbColumnToR(column, [null, undefined])).toEqual({rType: 'integer'});
  });

  it('falls back to numeric for wide integers above the int32 range', () => {
    const column = measureColumn('einwohner');
    expect(mapDuckDbColumnToR(column, [2147483648n])).toEqual({rType: 'numeric'});
    expect(mapDuckDbColumnToR(column, [-2147483649n, 10n])).toEqual({rType: 'numeric'});
    expect(mapDuckDbColumnToR(column, [9007199254740991n])).toEqual({rType: 'numeric'});
  });

  it('keeps wide integers above double precision lossless as character', () => {
    const column = measureColumn('objekt_nr');
    expect(mapDuckDbColumnToR(column, [9007199254740993n])).toMatchObject({
      rType: 'character',
      warning: expect.stringContaining('64-bit Integer')
    });
    expect(mapDuckDbColumnToR(column, [1n, 18446744073709551615n])).toMatchObject({rType: 'character'});
    expect(mapDuckDbColumnToR(column, [9007199254740993])).toMatchObject({rType: 'character'});
    expect(mapDuckDbColumnToR(column, ['keine Zahl'])).toMatchObject({rType: 'character'});
  });

  it('keeps identifier columns as character even when the values are small', () => {
    expect(mapDuckDbColumnToR(
      {name: 'bfs_nr', duckdbType: 'BIGINT', nullable: false, roles: ['identifier']},
      [1n, 2n]
    )).toMatchObject({rType: 'character', warning: expect.stringContaining('Identifier')});
  });
});

describe('normalizeDuckDbValueForR', () => {
  it('serializes dates, bigints, binaries and nulls for JSON transfer', () => {
    expect(normalizeDuckDbValueForR(null, {rType: 'character'})).toBeNull();
    expect(normalizeDuckDbValueForR(123n, {rType: 'character'})).toBe('123');
    expect(normalizeDuckDbValueForR(123n, {rType: 'integer'})).toBe(123);
    expect(normalizeDuckDbValueForR(5000000000n, {rType: 'numeric'})).toBe(5000000000);
    expect(normalizeDuckDbValueForR(new Date('2026-07-06T10:11:12Z'), {rType: 'Date'})).toBe('2026-07-06');
    expect(normalizeDuckDbValueForR(new Date('2026-07-06T10:11:12Z'), {rType: 'POSIXct'})).toBe('2026-07-06T10:11:12.000Z');
    expect(normalizeDuckDbValueForR(new Uint8Array([1, 2, 3]), {rType: 'character'})).toBe('[3 Bytes]');
  });
});
