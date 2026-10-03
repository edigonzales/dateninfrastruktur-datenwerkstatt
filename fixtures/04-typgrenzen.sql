-- DuckDB-Zieltest; mit echter DuckDB-WASM-Baseline auszuführen.
SELECT
  CAST('-2147483648' AS INTEGER) AS int32_min,
  CAST('2147483648' AS BIGINT) AS safe_int64,
  CAST('9007199254740993' AS BIGINT) AS wide_int64,
  CAST('18446744073709551615' AS UBIGINT) AS uint64_max,
  CAST('12345678901234.5678' AS DECIMAL(18,4)) AS exakter_betrag,
  CAST('001' AS VARCHAR) AS kennung,
  CAST(NULL AS DOUBLE) AS fehlend,
  CAST('NaN' AS DOUBLE) AS nan_wert,
  CAST('Infinity' AS DOUBLE) AS plus_unendlich,
  CAST('-Infinity' AS DOUBLE) AS minus_unendlich,
  CAST('' AS VARCHAR) AS leertext,
  CAST('NULL' AS VARCHAR) AS null_text,
  DATE '2026-03-29' AS datum,
  TIMESTAMPTZ '2026-03-29 01:30:00+00:00' AS zeit_utc,
  TIMESTAMP_NS '2026-01-01 12:34:56.123456789' AS nanos;
