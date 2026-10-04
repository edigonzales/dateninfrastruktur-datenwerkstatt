# ADR-003: Benannte SQL-Parameter im gepinnten WASM-Binder

Datum: 2026-10-04. Gilt für `@duckdb/duckdb-wasm@1.33.1-dev57.0`, tatsächliche Engine `v1.5.4`; kein Versionsupgrade.

## Reproduzierbarer Befund

Die installierte `AsyncPreparedStatement.query(...params)`-API nimmt ein Positionsarray entgegen. Im echten Chromium-Worker scheitert `connection.prepare('SELECT $text, CAST($exact AS BIGINT)')` gefolgt von `statement.query("x'; SELECT 9; --", '9007199254740993')` mit `Values were not provided for ... exact, text`. Der gleiche Versuch als Prepared-CTAS scheitert ebenso. Die ersten drei gezielten P3-Probeläufe endeten mit Exit 1; keine davon wurde als Erfolg gewertet.

`json_serialize_sql` liefert dagegen nachweislich `named_param_map: [{key: 'text', value: 1}, {key: 'exact', value: 2}]`. Die Engine kann ihren eigenen AST per `json_deserialize_sql` wieder ausgeben. Ein JS-JSON-Rundlauf des AST ist ungeeignet: `query_location` enthält den uint64-Sentinel 18446744073709551615; nach JS-Number-Rundung scheiterte die Deserialisierung mit `expected type uint64_t`. Auch fachliche numerische Konstanten dürfen nicht durch diesen Rundlauf verändert werden.

## Entscheidung

Der SELECT-Guard validiert den geparsten AST mit expliziten Knoten-, Funktions- und Quellenregeln. Für die Rückübersetzung bekommt DuckDB ausschliesslich den **ursprünglichen JSON-Text**, keine mit `JSON.stringify` veränderte Kopie. Auf dem von DuckDB ausgegebenen SQL ersetzt ein Tokenlauf nur benannte Parameter durch nummerierte Platzhalter. Stringliterale, Escape-/Dollarstrings und gequotete Bezeichner bleiben unverändert. Werte werden separat an das Prepared Statement gebunden; int64/decimal/date/timestamp bleiben Text.

Die echte Ausführung ist eine Prepared-CTAS mit überprüftem N+1-Wrapper, stabilem internem Ordinal und einmaliger Benutzerquery. DESCRIBE bindet nur das Schema. Ein COUNT auf der bereits auf N+1 begrenzten privaten Relation ermittelt ausschliesslich die materialisierte Menge. Paging/Sortierung/Export lesen diese Relation. Interne Parquet-Snapshots behalten den Ordinal; CSV, Nutzer-Parquet und Arrow exportieren ihn nicht.

## Nachweis

`tests/integration/sql.spec.ts` prüft diese Kombination mit echten Engines: Quotes/Semikolons als Parameterwert, mehrfach verwendeter Parameter, int64 oberhalb 2^53, exakte SQL-Konstanten, DECIMAL, Parametertext innerhalb eines Literals und doppelte Spaltennamen. Derselbe Korpus prüft erlaubte Analysesyntax und verbotene externe/interne Quellen. Der Guard erlaubt explizit `main.list_value`, das DuckDB selbst für Arrayliterale erzeugt. CTE-Namen mit Datei-/URL-Pfadzeichen werden abgelehnt, um Replacement-Scans unter CTE-Namen auszuschliessen.

Keine neue direkte Dependency, kein SQL-Templating von Werten und keine Änderung an den eigenen Verträgen unter `contracts/`.
