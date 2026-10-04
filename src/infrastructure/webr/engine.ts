import {checkRuntimeAsset} from '../browser/runtimeAsset';
import {measure} from '../../application/diagnostics';
import type {WebR, REnvironment, RObject} from 'webr';
import type {
  REngine,
  RScope,
  RObjectRef,
  RObjectSummary,
  ColumnarPayload,
  ColumnVector,
  ROutputEvent,
} from '../../application/ports';
import type {ExecutionSnapshot, RunId, RuntimeFingerprint, ColumnSchema} from '../../domain/model';
import type {RuntimeConfig} from '../../../contracts/runtime-config';
import {AppFailure} from '../../application/errors';
import {bindingNameSchema, tableSchema} from '../../domain/workspace';
import {validatePayload, schemaColumn, validateExactText} from '../../application/rTypeCodec';
import {z} from 'zod';
interface ScopeState {
  ref: RScope;
  env: REnvironment;
  mode: 'workspace-session' | 'fresh-environment';
}
/** Workspace lifetime; no React ownership. All object proxies remain inside this adapter. */
export class WebREngine implements REngine {
  private runtime: WebR | undefined;
  private module: typeof import('webr') | undefined;
  private initializing: Promise<void> | undefined;
  private scopes = new Map<string, ScopeState>();
  private active: {id: RunId; controller: AbortController} | undefined;
  private closed = false;
  private packageVersions: Record<string, string> = {};
  epoch = 0;
  mutation = 0;
  constructor(
    readonly sessionId: string,
    private readonly config: RuntimeConfig,
  ) {}
  supportsInterrupt() {
    return this.config.runtimes.webRChannel === 'auto' && globalThis.crossOriginIsolated;
  }
  private async bounded<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => {
        const stop = () => {
          void this.reset().then(
            () =>
              reject(
                new AppFailure(
                  'CANCELLED',
                  'R-Worker beendet; ungesicherte Objekte und Scopes wurden verworfen.',
                ),
              ),
            reject,
          );
        };
        if (this.supportsInterrupt() && this.runtime) {
          try {
            this.runtime.interrupt();
            timer = setTimeout(stop, this.config.limits.cancelGraceMs);
          } catch {
            stop();
          }
        } else stop();
      };
      signal.addEventListener('abort', abort, {once: true});
      void work()
        .then((value) => {
          if (signal.aborted) reject(new AppFailure('CANCELLED', 'R-Ausführung abgebrochen.'));
          else resolve(value);
        }, reject)
        .finally(() => {
          signal.removeEventListener('abort', abort);
          if (timer) clearTimeout(timer);
        })
        .catch(() => {});
    });
  }
  initialize(callerSignal: AbortSignal) {
    const timeout = AbortSignal.timeout(this.config.limits.rTimeoutMs);
    const signal = AbortSignal.any([callerSignal, timeout]);
    if (this.closed)
      return Promise.reject(new AppFailure('RUNTIME_RESET', 'R-Sitzung geschlossen.'));
    return this.bounded(
      signal,
      () =>
        (this.initializing ??= measure('R Worker initialisieren', async () => {
          const epoch = this.epoch;
          const base = new URL(
            this.config.runtimes.webRBaseUrl,
            location.origin + this.config.appBasePath,
          ).href;
          const repo = new URL(
            this.config.runtimes.webRPackageRepoUrl,
            location.origin + this.config.appBasePath,
          ).href;
          const url = new URL('webr.js', base).href;
          await checkRuntimeAsset(url, 'javascript', signal);
          await checkRuntimeAsset(new URL('R.wasm', base).href, 'wasm', signal);
          const module: typeof import('webr') = await import(/* @vite-ignore */ url);
          if (epoch !== this.epoch || this.closed)
            throw new AppFailure('RUNTIME_RESET', 'Initialisierung verworfen.');
          this.module = module;
          const runtime = new module.WebR({
            baseUrl: base,
            repoUrl: repo,
            channelType: this.supportsInterrupt()
              ? module.ChannelType.SharedArrayBuffer
              : module.ChannelType.PostMessage,
            // In webR 0.6.0 non-interactive R cannot resume after a native SAB
            // interrupt. PostMessage still uses termination (ADR-008).
            interactive: this.supportsInterrupt(),
          });
          this.runtime = runtime;
          try {
            await runtime.init();
            await runtime.evalRVoid('options(device=webr::canvas); Sys.setenv(TZ="UTC")');
            const response = await fetch(
              new URL(
                this.config.runtimes.packageLockUrl,
                location.origin + this.config.appBasePath,
              ),
              {
                credentials: 'omit',
                redirect: 'error',
                signal,
              },
            );
            if (!response.ok) throw new AppFailure('R_ERROR', `Paketlock: HTTP ${response.status}`);
            const lock = z
              .object({
                rootPackages: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9.]*$/)),
                packages: z.array(z.object({name: z.string(), version: z.string()})),
              })
              .parse(await response.json());
            await runtime.installPackages(
              lock.packages.map((p) => p.name),
              {
                repos: repo,
                mount: false,
                quiet: true,
              },
            );
            const env = await new runtime.REnvironment();
            try {
              for (const p of lock.packages) {
                await env.bind('lab_package', p.name);
                const version = await runtime.evalRString(
                  'utils::packageDescription(lab_package, fields="Version")',
                  {env},
                );
                if (version !== p.version)
                  throw new AppFailure('R_ERROR', `R-Paketstand weicht vom Lock ab: ${p.name}`);
                this.packageVersions[p.name] = version;
              }
            } finally {
              await runtime.destroy(env);
            }
          } catch (e) {
            runtime.close();
            if (this.runtime === runtime) {
              this.runtime = undefined;
              this.initializing = undefined;
            }
            throw e;
          }
          if (epoch !== this.epoch) {
            runtime.close();
            throw new AppFailure('RUNTIME_RESET', 'Initialisierung aus alter Epoche.');
          }
        }).catch((error) => {
          this.initializing = undefined;
          throw error;
        })),
    ).catch((error) => {
      if (timeout.aborted && !callerSignal.aborted)
        throw new AppFailure(
          'TIMEOUT',
          'R-Initialisierung überschritt das Laufzeitlimit; der Worker wurde beendet.',
          true,
        );
      throw error;
    });
  }
  private current(scope: RScope) {
    const state = this.scopes.get(scope.key);
    if (
      !this.runtime ||
      scope.sessionId !== this.sessionId ||
      scope.engineEpoch !== this.epoch ||
      !state
    )
      throw new AppFailure('RUNTIME_RESET', 'RScope ist nicht mehr gültig.');
    return state;
  }
  async fingerprint(): Promise<RuntimeFingerprint> {
    const r = this.runtime;
    if (!r) throw new AppFailure('RUNTIME_RESET', 'R nicht initialisiert.');
    const names = await r.evalRRaw('loadedNamespaces()', 'string[]');
    const versions: Record<string, string> = {...this.packageVersions};
    const env = await new r.REnvironment();
    try {
      for (const name of names) {
        await env.bind('lab_package', name);
        versions[name] = await r.evalRString(
          'utils::packageDescription(lab_package, fields="Version")',
          {
            env,
          },
        );
      }
    } finally {
      await r.destroy(env);
    }
    return {
      appBuildId: this.config.buildId,
      engineId: 'webr-local',
      engineVersion: 'webR 0.6.0',
      rVersion: await r.evalRString('R.version.string'),
      rPackageVersions: versions,
      transferCodecVersion: 'columnar-1',
      locale: await r.evalRString('Sys.getlocale()'),
      timeZone: await r.evalRString('Sys.getenv("TZ")'),
    };
  }
  async createScope(mode: 'workspace-session' | 'fresh-environment') {
    if (!this.runtime) throw new AppFailure('RUNTIME_RESET', 'R nicht initialisiert.');
    const prior = [...this.scopes.values()].find((s) => s.mode === 'workspace-session');
    if (mode === 'workspace-session' && prior) return prior.ref;
    const ref = {sessionId: this.sessionId, engineEpoch: this.epoch, key: crypto.randomUUID()};
    const env = await new this.runtime.REnvironment();
    this.scopes.set(ref.key, {ref, env, mode});
    return ref;
  }
  private async temp<T>(work: (r: WebR, env: REnvironment) => Promise<T>) {
    const r = this.runtime;
    if (!r) throw new AppFailure('RUNTIME_RESET', 'R fehlt.');
    const epoch = this.epoch,
      env = await new r.REnvironment();
    try {
      return await work(r, env);
    } finally {
      if (this.runtime === r && epoch === this.epoch) await r.destroy(env);
    }
  }
  async bindDataFrame(scope: RScope, name: string, payload: ColumnarPayload, signal: AbortSignal) {
    bindingNameSchema.parse(name);
    validatePayload(payload, this.config.limits.rHardRows, this.config.limits.transferBytes);
    const destination = this.current(scope);
    await this.bounded(signal, () =>
      this.temp(async (r, env) => {
        const epoch = this.epoch;
        await r.evalRVoid('lab_cols <- list()', {env});
        for (const c of payload.columns) {
          signal.throwIfAborted();
          const values = Array.from({length: payload.rowCount}, (_, i) =>
            c.validity[i] ? c.values[i]! : null,
          );
          let vector: RObject;
          let conversion = '';
          if (c.schema.logicalType === 'DATE' && c.encoding === 'text') {
            vector = await new r.RDouble(
              c.values.map((v, i) =>
                c.validity[i] ? Date.parse(`${v}T00:00:00Z`) / 86400000 : null,
              ),
            );
            conversion = 'lab_vector <- structure(lab_vector,class="Date")';
          } else if (
            c.encoding === 'text' &&
            c.schema.logicalType.startsWith('TIMESTAMP') &&
            c.values.every(
              (v, i) =>
                !c.validity[i] ||
                /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.0+)?(?:Z|[+-]00(?::?00)?)?$/.test(v),
            )
          ) {
            const seconds = c.values.map((v, i) =>
              c.validity[i]
                ? Date.parse(v.replace(' ', 'T').replace(/(?:Z|\+00(?::?00)?)$/, '') + 'Z') / 1000
                : null,
            );
            if (seconds.some((v) => v !== null && !Number.isSafeInteger(v)))
              throw new AppFailure('TYPE_UNSUPPORTED', 'Zeitpunkt nicht exakt darstellbar.');
            vector = await new r.RDouble(seconds);
            conversion =
              'lab_vector <- structure(lab_vector,class=c("POSIXct","POSIXt"),tzone="UTC")';
          } else if (c.encoding === 'text')
            vector = await new r.RCharacter(values as (string | null)[]);
          else if (c.encoding === 'boolean')
            vector = await new r.RLogical(values.map((v) => (v === null ? null : !!v)));
          else if (c.encoding === 'int32')
            vector = await new r.RInteger(values as (number | null)[]);
          else if (c.encoding === 'float64')
            vector = await new r.RDouble(values as (number | null)[]);
          else throw new AppFailure('TYPE_UNSUPPORTED', 'Binärspalte nicht für R geeignet.');
          try {
            await env.bind('lab_vector', vector);
            // R's NA_REAL NaN payload is not preserved by every browser's JS/WASM bridge.
            // Construct NA in R after transporting a separate, ordinary logical mask.
            const missing = await new r.RLogical(Array.from(c.validity, (v) => v === 0));
            try {
              await env.bind('lab_missing', missing);
              await r.evalRVoid('lab_vector[lab_missing] <- NA', {env});
            } finally {
              if (this.epoch === epoch) await r.destroy(missing);
            }
            await env.bind('lab_schema', JSON.stringify(c.schema));
            await r.evalRVoid(
              `${conversion ? conversion + ';' : ''}attr(lab_vector,"lab_schema") <- lab_schema; lab_cols[[length(lab_cols)+1L]] <- lab_vector`,
              {env},
            );
          } finally {
            if (this.epoch === epoch) await r.destroy(vector);
          }
        }
        await env.bind(
          'lab_names',
          payload.schema.columns.map((c) => c.name),
        );
        await env.bind('lab_n', payload.rowCount);
        await env.bind('lab_metadata', JSON.stringify(payload.schema.metadata));
        const frame = await r.evalR(
          'names(lab_cols) <- lab_names; structure(lab_cols,class="data.frame",row.names=.set_row_names(lab_n),lab_metadata=lab_metadata)',
          {env},
        );
        try {
          signal.throwIfAborted();
          this.current(scope);
          await destination.env.bind(name, frame);
          this.mutation++;
        } finally {
          if (this.epoch === epoch) await r.destroy(frame);
        }
      }),
    );
  }
  async evaluate(
    scope: RScope,
    runId: RunId,
    snapshot: ExecutionSnapshot,
    onOutput: (event: ROutputEvent) => void,
    signal: AbortSignal,
  ) {
    const state = this.current(scope),
      r = this.runtime!,
      epoch = this.epoch,
      controller = new AbortController();
    this.active = {id: runId, controller};
    this.mutation++;
    const joined = AbortSignal.any([signal, controller.signal]);
    try {
      await this.bounded(joined, async () => {
        let phase = 'Shelter';
        const shelter = await new r.Shelter();
        try {
          phase = 'Parameterliste';
          const params = await new r.RList(
            Object.fromEntries(
              Object.entries(snapshot.parameters).map(([key, v]) => [
                key,
                v === null ? r.objs.null : typeof v === 'object' ? v.value : v,
              ]),
            ),
          );
          try {
            await state.env.bind('params', params);
          } finally {
            await r.destroy(params);
          }
          if (snapshot.randomSeed !== undefined) {
            await state.env.bind('lab_seed', snapshot.randomSeed);
            await r.evalRVoid('set.seed(lab_seed); rm(lab_seed)', {env: state.env});
          }
          phase = 'captureR';
          const captured = await shelter.captureR(snapshot.code, {
            env: state.env,
            throwJsException: false,
            withAutoprint: true,
            captureGraphics: {width: 720, height: 480, bg: 'white', capture: true},
          });
          if (epoch !== this.epoch || joined.aborted) {
            for (const image of captured.images) image.close();
            throw new AppFailure('CANCELLED', 'Verspätete R-Antwort verworfen.');
          }
          phase = 'Ausgaben';
          let failure: string | undefined;
          for (const event of captured.output) {
            const data: unknown = event.data;
            let text: string;
            if (typeof data === 'string') text = data;
            else if (this.module!.isRObject(data)) {
              text = await this.temp(async (runtime, env) => {
                await env.bind('lab_condition', data);
                return runtime.evalRString('conditionMessage(lab_condition)', {env});
              });
            } else throw new AppFailure('R_ERROR', 'Unbekanntes R-Ausgabeformat.');
            if (event.type === 'error') {
              failure = text;
              onOutput({kind: 'stderr', text});
            } else if (['stdout', 'stderr', 'warning', 'message'].includes(event.type))
              onOutput({kind: event.type as 'stdout' | 'stderr' | 'warning' | 'message', text});
          }
          for (const image of captured.images) onOutput({kind: 'plot', image});
          if (failure) throw new AppFailure('R_ERROR', failure);
        } catch (error) {
          if (error instanceof AppFailure) throw error;
          throw new AppFailure(
            'R_ERROR',
            `R ${phase}: ${error instanceof Error ? error.message || error.name : String(error)}`,
          );
        } finally {
          if (this.runtime === r && epoch === this.epoch) await shelter.purge();
        }
      });
    } finally {
      if (this.active?.id === runId) this.active = undefined;
    }
  }
  async listObjects(scope: RScope): Promise<RObjectSummary[]> {
    const state = this.current(scope);
    const names = await state.env.ls();
    const result: RObjectSummary[] = [];
    await this.temp(async (r, env) => {
      for (const name of names.filter((n) => n !== 'params' && !n.startsWith('lab_'))) {
        await env.bind('lab_source', state.env);
        await env.bind('lab_name', name);
        const object = await r.evalR('get(lab_name,envir=lab_source,inherits=FALSE)', {env});
        try {
          await env.bind('lab_object', object);
          const classes = await r.evalRRaw('class(lab_object)', 'string[]', {env});
          const frame = await r.evalRBoolean('is.data.frame(lab_object)', {env});
          result.push({
            ref: {scope, name},
            classes,
            isDataFrame: frame,
            ...(frame
              ? {
                  rowCount: await r.evalRNumber('nrow(lab_object)', {env}),
                  columnCount: await r.evalRNumber('ncol(lab_object)', {env}),
                }
              : {}),
          });
        } finally {
          await r.destroy(object);
        }
      }
    });
    return result;
  }
  async readDataFrame(ref: RObjectRef, signal: AbortSignal): Promise<ColumnarPayload> {
    const state = this.current(ref.scope),
      module = this.module!;
    return this.bounded(signal, () =>
      this.temp(async (r, env) => {
        await env.bind('lab_source', state.env);
        await env.bind('lab_name', ref.name);
        const object = await r.evalR('get(lab_name,envir=lab_source,inherits=FALSE)', {env});
        try {
          await env.bind('lab_df', object);
        } finally {
          await r.destroy(object);
        }
        if (!(await r.evalRBoolean('is.data.frame(lab_df)', {env})))
          throw new AppFailure('TYPE_UNSUPPORTED', 'Objekt ist kein Dataframe.');
        const n = await r.evalRNumber('nrow(lab_df)', {env}),
          bytes = await r.evalRNumber('as.numeric(object.size(lab_df))', {env});
        if (n > this.config.limits.rHardRows || bytes > this.config.limits.transferBytes)
          throw new AppFailure('LIMIT_EXCEEDED', 'R-Objekt überschreitet das Transferbudget.');
        const names = await r.evalRRaw('names(lab_df)', 'string[]', {env});
        const columns: ColumnVector[] = [];
        for (const [index, name] of names.entries()) {
          signal.throwIfAborted();
          await env.bind('lab_i', index + 1);
          await r.evalRVoid('lab_col <- lab_df[[lab_i]]', {env});
          const type = await r.evalRString('typeof(lab_col)', {env});
          const classes = await r.evalRRaw('class(lab_col)', 'string[]', {env});
          if (!['logical', 'integer', 'double', 'character'].includes(type))
            throw new AppFailure('TYPE_UNSUPPORTED', `${name}: ${type} ist nicht unterstützt.`);
          const annotation = await r.evalRString(
            'if(is.null(attr(lab_col,"lab_schema"))) "" else attr(lab_col,"lab_schema")',
            {env},
          );
          let schema: ColumnSchema = annotation
            ? (() => {
                const {description, ...col} = tableSchema.parse({
                  columns: [JSON.parse(annotation) as unknown],
                  metadata: {},
                }).columns[0]!;
                return {...col, ...(description === undefined ? {} : {description})};
              })()
            : schemaColumn(
                name,
                type === 'logical'
                  ? 'BOOLEAN'
                  : type === 'integer'
                    ? 'INTEGER'
                    : type === 'double'
                      ? 'DOUBLE'
                      : 'VARCHAR',
              );
          schema = {...schema, name};
          if (classes.includes('factor')) {
            schema = schemaColumn(name, 'VARCHAR');
            schema.metadata.factorLevels = JSON.stringify(
              await r.evalRRaw('levels(lab_col)', 'string[]', {env}),
            );
            schema.metadata.factorOrdered = String(classes.includes('ordered'));
            await r.evalRVoid('lab_col <- as.character(lab_col)', {env});
          } else if (classes.includes('Date') || classes.includes('POSIXct')) {
            schema = {
              ...schema,
              logicalType: classes.includes('Date')
                ? 'DATE'
                : annotation
                  ? schema.logicalType
                  : 'TIMESTAMPTZ',
            };
            await r.evalRVoid('lab_col <- unclass(lab_col)', {env});
          }
          const value = await r.evalR('lab_col', {env});
          try {
            let column: ColumnVector;
            if (module.isRCharacter(value)) {
              const values = z.array(z.string().nullable()).parse(await value.toArray());
              for (const v of values)
                if (v !== null) validateExactText(v, schema.logicalType, name);
              column = {
                schema,
                encoding: 'text',
                validity: Uint8Array.from(values, (v) => (v === null ? 0 : 1)),
                values: values.map((v) => v ?? ''),
              };
            } else if (module.isRLogical(value)) {
              const values = await value.toArray();
              column = {
                schema,
                encoding: 'boolean',
                validity: Uint8Array.from(values, (v) => (v === null ? 0 : 1)),
                values: Uint8Array.from(values, (v) => (v ? 1 : 0)),
              };
            } else if (module.isRInteger(value) || module.isRDouble(value)) {
              const missing = await r.evalRRaw('is.na(lab_col) & !is.nan(lab_col)', 'boolean[]', {
                env,
              });
              const base = {schema, validity: Uint8Array.from(missing, (v) => (v ? 0 : 1))};
              if (classes.includes('Date') || classes.includes('POSIXct')) {
                const numbers = await value.toTypedArray();
                const values = Array.from(numbers, (n, i) => {
                  if (!base.validity[i]) return '';
                  if (!Number.isSafeInteger(n))
                    throw new AppFailure(
                      'TYPE_UNSUPPORTED',
                      `${name}: Zeitwert nicht ohne Precision-Loss darstellbar. Bitte explizit als Text formatieren.`,
                    );
                  const iso = new Date(
                    n * (classes.includes('Date') ? 86400000 : 1000),
                  ).toISOString();
                  return classes.includes('Date')
                    ? iso.slice(0, 10)
                    : iso.replace('T', ' ').replace('.000Z', '');
                });
                column = {...base, encoding: 'text', values};
              } else
                column = module.isRInteger(value)
                  ? {...base, encoding: 'int32', values: await value.toTypedArray()}
                  : {...base, encoding: 'float64', values: await value.toTypedArray()};
            } else throw new AppFailure('TYPE_UNSUPPORTED', `${name}: R-Vektor nicht unterstützt.`);
            columns.push(column);
          } finally {
            await r.destroy(value);
          }
        }
        const payload: ColumnarPayload = {
          schema: {
            columns: columns.map((c) => c.schema),
            metadata: z
              .record(z.string(), z.string())
              .parse(
                JSON.parse(
                  await r.evalRString(
                    'if(is.null(attr(lab_df,"lab_metadata"))) "{}" else attr(lab_df,"lab_metadata")',
                    {env},
                  ),
                ) as unknown,
              ),
          },
          rowCount: n,
          columns,
          issues: [],
        };
        validatePayload(payload, this.config.limits.rHardRows, this.config.limits.transferBytes);
        return payload;
      }),
    );
  }
  async releaseScope(scope: RScope) {
    const state = this.scopes.get(scope.key);
    if (!state || scope.engineEpoch !== this.epoch) return;
    this.scopes.delete(scope.key);
    if (this.runtime) await this.runtime.destroy(state.env);
  }
  async cancel(runId: RunId) {
    if (this.active?.id !== runId) return 'already-settled' as const;
    const old = this.epoch;
    this.active.controller.abort();
    return old === this.epoch ? ('interrupted' as const) : ('runtime-reset' as const);
  }
  async reset() {
    const runtime = this.runtime;
    this.epoch++;
    this.mutation++;
    this.runtime = undefined;
    this.initializing = undefined;
    this.scopes.clear();
    this.packageVersions = {};
    runtime?.close();
  }
  async dispose() {
    if (this.closed) return;
    this.closed = true;
    await this.reset();
  }
}
