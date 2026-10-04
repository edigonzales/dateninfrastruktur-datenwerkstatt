import {z} from 'zod';
import {AppFailure} from '../../application/errors';
import type {ParameterValue} from '../../domain/model';
import {parameterSchema} from '../../domain/workspace';
import type {AsyncDuckDBConnection} from '@duckdb/duckdb-wasm';
const envelope = z.object({
  error: z.literal(false),
  statements: z
    .array(
      z.object({node: z.record(z.string(), z.unknown()), named_param_map: z.array(z.unknown())}),
    )
    .length(1),
});
const expressions = new Set([
  'CONSTANT',
  'COLUMN_REF',
  'STAR',
  'FUNCTION',
  'AGGREGATE',
  'WINDOW',
  'OPERATOR',
  'COMPARISON',
  'CONJUNCTION',
  'CAST',
  'CASE',
  'SUBQUERY',
  'PARAMETER',
  'BETWEEN',
  'LAMBDA',
  'DEFAULT',
]);
const nodes = new Set([
  'SELECT_NODE',
  'DECIMAL_TYPE_INFO',
  'ASCENDING',
  'DESCENDING',
  'ORDER_DEFAULT',
  'SET_OPERATION_NODE',
  'CTE_NODE',
  'RECURSIVE_CTE_NODE',
  'BASE_TABLE',
  'EMPTY',
  'JOIN',
  'SUBQUERY',
  'TABLE_FUNCTION',
  'EXPRESSION_LIST',
  'ORDER_MODIFIER',
  'LIMIT_MODIFIER',
  'DISTINCT_MODIFIER',
]);
const tableFunctions = new Set(['range', 'generate_series', 'unnest']);
const functions = new Set([
  ...tableFunctions,
  '+',
  '-',
  '*',
  '/',
  '//',
  '%',
  '**',
  '~~',
  '!~~',
  '~~*',
  '!~~*',
  'sum',
  'avg',
  'count',
  'count_star',
  'struct_pack',
  'min',
  'max',
  'median',
  'mode',
  'stddev',
  'stddev_samp',
  'stddev_pop',
  'variance',
  'var_samp',
  'var_pop',
  'quantile_cont',
  'quantile_disc',
  'abs',
  'round',
  'ceil',
  'ceiling',
  'floor',
  'sqrt',
  'pow',
  'power',
  'exp',
  'ln',
  'log',
  'log10',
  'sin',
  'cos',
  'tan',
  'sign',
  'random',
  'coalesce',
  'nullif',
  'if',
  'ifnull',
  'greatest',
  'least',
  'isnan',
  'isfinite',
  'isinf',
  'lower',
  'upper',
  'length',
  'char_length',
  'trim',
  'ltrim',
  'rtrim',
  'replace',
  'repeat',
  'regexp_replace',
  'regexp_matches',
  'regexp_extract',
  'substr',
  'substring',
  'concat',
  'concat_ws',
  'starts_with',
  'ends_with',
  'contains',
  'lpad',
  'rpad',
  'date_part',
  'date_trunc',
  'date_diff',
  'date_add',
  'strftime',
  'strptime',
  'try_strptime',
  'year',
  'month',
  'day',
  'dayofweek',
  'epoch',
  'make_date',
  'now',
  'today',
  'current_date',
  'row_number',
  'rank',
  'dense_rank',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  'nth_value',
  'first',
  'last',
  'string_agg',
  'list',
  'array_agg',
  'list_value',
  'list_extract',
  'list_transform',
  'list_filter',
]);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function reject(message: string): never {
  throw new AppFailure('SQL_NOT_ALLOWED', `SQL_NOT_ALLOWED: ${message}`);
}

/** Only the engine's SELECT serializer parses code. This visitor validates sources and expressions. */
export function validateSelectAst(raw: unknown, tables: ReadonlySet<string>) {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) reject('Genau eine gültige SELECT-Anweisung ist erlaubt.');
  function visit(value: unknown, inherited: ReadonlySet<string>) {
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, inherited));
      return;
    }
    if (!record(value)) return;
    const ctes = new Set(inherited);
    if (record(value.cte_map) && Array.isArray(value.cte_map.map)) {
      for (const entry of value.cte_map.map) {
        if (
          !record(entry) ||
          typeof entry.key !== 'string' ||
          /[.:/\\]/.test(entry.key) ||
          entry.key.toLowerCase().startsWith('__dw_')
        )
          reject('Ungültiger CTE-Name.');
        ctes.add(entry.key.toLowerCase());
      }
    }
    if (typeof value.class === 'string' && !expressions.has(value.class))
      reject(`Unbekannter Ausdruck ${value.class}.`);
    if (typeof value.type === 'string' && !('class' in value) && !nodes.has(value.type))
      reject(`Unbekannter Knoten ${value.type}.`);
    if (value.type === 'BASE_TABLE') {
      const name = typeof value.table_name === 'string' ? value.table_name.toLowerCase() : '';
      if (value.catalog_name !== '' || (value.schema_name !== '' && value.schema_name !== 'data'))
        reject('Nur Workspace-Tabellen sind erlaubt.');
      if (name.startsWith('__dw_')) reject('Interne Tabellen sind reserviert.');
      if (!tables.has(name) && !(value.schema_name === '' && ctes.has(name)))
        reject(`Tabelle ${name} gehört nicht zum Workspace.`);
      if (value.at_clause !== null) reject('Historische externe Quellen sind nicht erlaubt.');
    }
    if (value.type === 'TABLE_FUNCTION') {
      if (
        !record(value.function) ||
        !tableFunctions.has(String(value.function.function_name).toLowerCase())
      )
        reject('Externe oder dynamische Tabellenfunktion.');
    }
    if (typeof value.function_name === 'string') {
      if (
        !functions.has(value.function_name.toLowerCase()) ||
        (value.schema !== '' && value.schema !== 'main' && value.schema !== undefined) ||
        (value.catalog !== '' && value.catalog !== undefined)
      )
        reject(`Funktion ${value.function_name} ist nicht freigegeben.`);
      if (value.export_state) reject('Export von Aggregatzustand ist nicht erlaubt.');
    }
    Object.values(value).forEach((child) => visit(child, ctes));
  }
  visit(parsed.data.statements, new Set());
  return parsed.data;
}
async function selectAst(
  connection: AsyncDuckDBConnection,
  code: string,
  tables: ReadonlySet<string>,
) {
  // A literal passed to DuckDB's parser, never execution of the input.
  const serialized: unknown = (
    await connection.query(`SELECT json_serialize_sql('${code.replaceAll("'", "''")}') AS ast`)
  )
    .getChildAt(0)
    ?.get(0);
  const json = z.string().parse(serialized);
  return {json, ast: validateSelectAst(JSON.parse(json) as unknown, tables)};
}
export async function guardQuery(
  connection: AsyncDuckDBConnection,
  code: string,
  tables: ReadonlySet<string>,
) {
  return (await selectAst(connection, code, tables)).ast;
}

/** Only placeholder tokens change. DuckDB prints the original lossless AST: never
 * round-trip numeric constants through JS Number/JSON.stringify. */
function numberedParameters(code: string, names: ReadonlyMap<string, string>) {
  let output = '';
  for (let i = 0; i < code.length; ) {
    const start = i;
    const char = code[i]!;
    if (char === "'" || char === '"') {
      const escaped = char === "'" && /(?:^|[^A-Za-z0-9_])E$/i.test(code.slice(0, i));
      i++;
      while (i < code.length) {
        if (escaped && code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i++] === char) {
          if (code[i] === char) {
            i++;
            continue;
          }
          break;
        }
      }
    } else if (char === '$' && (i === 0 || !/[A-Za-z0-9_$]/.test(code[i - 1]!))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(code.slice(i))?.[0];
      if (tag) {
        const end = code.indexOf(tag, i + tag.length);
        if (end < 0) reject('Ungültiger Textwert.');
        i = end + tag.length;
      } else {
        const name = /^\$([A-Za-z][A-Za-z0-9_]*)/.exec(code.slice(i));
        if (!name || !names.has(name[1]!.toLowerCase())) reject('Unbekannter Parameter.');
        output += '$' + names.get(name[1]!.toLowerCase());
        i += name[0].length;
        continue;
      }
    } else i++;
    output += code.slice(start, i);
  }
  return output;
}
/** The pinned WASM binder accepts positional keys only. Values never enter SQL. */
export async function prepareSelect(
  connection: AsyncDuckDBConnection,
  code: string,
  tables: ReadonlySet<string>,
  parameters: Record<string, ParameterValue>,
) {
  const {ast, json} = await selectAst(connection, code, tables);
  const bindings = z
    .array(
      z.object({
        key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        value: z.number().int().positive(),
      }),
    )
    .parse(ast.statements[0]!.named_param_map)
    .sort((a, b) => a.value - b.value);
  if (bindings.some((b, i) => b.value !== i + 1)) reject('Ungültige Parameterposition.');
  const names = new Map(bindings.map((b) => [b.key.toLowerCase(), String(b.value)]));
  const values = bindings.map((binding) => {
    if (!Object.hasOwn(parameters, binding.key))
      throw new AppFailure('VALIDATION_FAILED', `Parameter ${binding.key} fehlt.`);
    const value = parameterSchema.parse(parameters[binding.key]);
    return value !== null && typeof value === 'object' ? value.value : value;
  });
  const normalized: unknown = (
    await connection.query(`SELECT json_deserialize_sql('${json.replaceAll("'", "''")}')`)
  )
    .getChildAt(0)
    ?.get(0);
  return {code: numberedParameters(z.string().parse(normalized), names), values};
}
