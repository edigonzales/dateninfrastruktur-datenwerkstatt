/** Alignment follows the logical type; numeric-looking identifiers remain text. */
export function numericColumn(logicalType: string | undefined): boolean {
  return /^(?:U?(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|FLOAT|DOUBLE|REAL|DECIMAL(?:\(\d+,\s*\d+\))?)$/.test(
    logicalType ?? '',
  );
}
