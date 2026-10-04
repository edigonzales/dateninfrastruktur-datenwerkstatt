import {z} from 'zod';
import type {RuntimeConfig} from '../../../contracts/runtime-config';
import type {
  CatalogAdapter,
  CatalogSelection,
  ResolvedCatalogTable,
  PublicSource,
} from '../../application/catalogPorts';
import type {DatasetVersion} from '../../domain/model';
import {AppFailure} from '../../application/errors';
import {exploreContextSchema} from './ExploreContext';
import {hashStream} from '../storage/artifactStore';
import {suggestSqlName} from '../../domain/workspace';
const target = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('dataset'), entryId: z.string().min(1)}),
  z.strictObject({
    kind: z.literal('issue'),
    seriesId: z.string().min(1),
    issueId: z.string().min(1),
  }),
  z.strictObject({kind: z.literal('current-issue'), seriesId: z.string().min(1)}),
]);
const indexSchema = z.strictObject({
  formatVersion: z.literal(1),
  providerId: z.string(),
  generatedAt: z.iso.datetime(),
  entries: z.array(
    z.strictObject({
      key: z.string(),
      title: z.string(),
      description: z.string().optional(),
      target,
      tableId: z.string().optional(),
    }),
  ),
});
export class PortalAccess implements CatalogAdapter, PublicSource {
  constructor(
    readonly config: RuntimeConfig,
    private readonly allowLocalHttp = false,
  ) {}
  url(value: string, base?: string) {
    const url = new URL(value, base);
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      !this.config.allowedDataOrigins.includes(url.origin) ||
      (url.protocol !== 'https:' &&
        !(
          this.allowLocalHttp &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        ))
    )
      throw new AppFailure(
        'SOURCE_UNAVAILABLE',
        'Unerlaubte Portal-/Daten-URL (Origin, Schema, Userinfo oder temporäre URL).',
      );
    return url;
  }
  provider(id: string) {
    const provider = this.config.portalProviders.find((p) => p.id === id);
    if (!provider) throw new AppFailure('SOURCE_UNAVAILABLE', 'Unbekannter Portalprovider.');
    return provider;
  }
  async response(url: string, signal: AbortSignal, mime: 'json' | 'parquet') {
    this.url(url);
    let response: Response;
    try {
      response = await fetch(url, {
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new AppFailure(
        'SOURCE_UNAVAILABLE',
        `Portal nicht erreichbar: CORS, Netzwerk oder Redirect. ${String(error)}`,
        true,
      );
    }
    if (!response.ok)
      throw new AppFailure(
        'SOURCE_UNAVAILABLE',
        `Portal: HTTP ${response.status}.`,
        response.status >= 500,
      );
    const type = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (
      mime === 'json'
        ? type !== 'application/json'
        : ![
            'application/vnd.apache.parquet',
            'application/octet-stream',
            'application/x-parquet',
          ].includes(type ?? '')
    )
      throw new AppFailure('SOURCE_UNAVAILABLE', `Falscher MIME-Typ: ${type ?? 'fehlt'}.`);
    return response;
  }
  async json(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.response(url, signal, 'json');
    if (!response.body) throw new AppFailure('SOURCE_UNAVAILABLE', 'Leere Portalantwort.');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    await hashStream(response.body, signal, 4 * 1024 * 1024, async (chunk) => {
      chunks.push(new Uint8Array(chunk));
    });
    return JSON.parse(await new Blob(chunks).text()) as unknown;
  }
  selection(providerId: string, value: string): CatalogSelection {
    const provider = this.provider(providerId);
    if (!value.includes('/') && !value.includes(':'))
      return {providerId, target: {kind: 'dataset', entryId: value.trim()}};
    const base = this.url(provider.baseUrl);
    const url = this.url(value, base.href);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
      throw new AppFailure('SOURCE_UNAVAILABLE', 'URL gehört nicht zur Portalbasis.');
    const parts = url.pathname
      .slice(base.pathname.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    if (
      parts[0] === 'datasets' &&
      parts[1] &&
      (parts.length === 2 || parts.slice(2).join('/') === 'explore/context.json')
    )
      return {providerId, target: {kind: 'dataset', entryId: parts[1]}};
    if (
      parts[0] === 'series' &&
      parts[1] &&
      parts[2] === 'issues' &&
      parts[3] &&
      (parts.length === 4 || parts.slice(4).join('/') === 'explore/context.json')
    )
      return {
        providerId,
        target:
          parts[3] === 'current'
            ? {kind: 'current-issue', seriesId: parts[1]}
            : {kind: 'issue', seriesId: parts[1], issueId: parts[3]},
      };
    throw new AppFailure('SOURCE_UNAVAILABLE', 'Erwartet wird eine Dataset- oder Ausgabe-URL.');
  }
  deepLink(search: string): CatalogSelection {
    const p = new URLSearchParams(search);
    const allowed = ['provider', 'dataset', 'series', 'issue', 'table'];
    if ([...p.keys()].some((k) => !allowed.includes(k) || p.getAll(k).length !== 1))
      throw new AppFailure(
        'VALIDATION_FAILED',
        'Deep Link enthält unerlaubte oder doppelte Parameter.',
      );
    const providerId = p.get('provider') ?? '';
    this.provider(providerId);
    const dataset = p.get('dataset'),
      series = p.get('series'),
      issue = p.get('issue');
    if (dataset ? series || issue : !series || !issue)
      throw new AppFailure('VALIDATION_FAILED', 'Dataset oder Serie mit Ausgabe angeben.');
    return {
      providerId,
      target: dataset
        ? {kind: 'dataset', entryId: dataset}
        : issue === 'current'
          ? {kind: 'current-issue', seriesId: series!}
          : {kind: 'issue', seriesId: series!, issueId: issue!},
      ...(p.get('table') ? {tableId: p.get('table')!} : {}),
    };
  }
  async search(providerId: string, text: string, signal: AbortSignal) {
    const provider = this.provider(providerId);
    if (!provider.indexUrl) return [];
    const index = indexSchema.parse(await this.json(this.url(provider.indexUrl).href, signal));
    if (index.providerId !== providerId)
      throw new AppFailure('SOURCE_UNAVAILABLE', 'Index gehört zu anderem Provider.');
    return index.entries
      .filter((e) =>
        `${e.title} ${e.description ?? ''}`.toLocaleLowerCase().includes(text.toLocaleLowerCase()),
      )
      .map(({description, tableId, ...e}) => ({
        ...e,
        ...(description === undefined ? {} : {description}),
        ...(tableId === undefined ? {} : {tableId}),
      }));
  }
  async resolve(selection: CatalogSelection, signal: AbortSignal): Promise<ResolvedCatalogTable[]> {
    const provider = this.provider(selection.providerId);
    const t = target.parse(selection.target);
    const path =
      t.kind === 'dataset'
        ? `datasets/${encodeURIComponent(t.entryId)}`
        : `series/${encodeURIComponent(t.seriesId)}/issues/${encodeURIComponent(t.kind === 'current-issue' ? 'current' : t.issueId)}`;
    const context = exploreContextSchema.parse(
      await this.json(this.url(`${path}/explore/context.json`, provider.baseUrl).href, signal),
    );
    if (!context.datasetId || !context.tables.length)
      throw new AppFailure('SOURCE_UNAVAILABLE', 'Portalkontext enthält keine Tabellen.');
    if (t.kind === 'issue' && context.datasetId !== t.issueId)
      throw new AppFailure('SOURCE_CHANGED', 'Portal liefert eine andere Ausgabe.');
    const resolvedTarget =
      t.kind === 'dataset'
        ? t
        : {kind: 'issue' as const, seriesId: t.seriesId, issueId: context.datasetId};
    const tables = context.tables.filter(
      (table) => !selection.tableId || table.id === selection.tableId,
    );
    if (!tables.length)
      throw new AppFailure('SOURCE_UNAVAILABLE', 'Ausgewählte Portaltabelle fehlt.');
    return tables.map((table) => ({
      providerId: provider.id,
      target: resolvedTarget,
      tableId: table.id,
      title: table.title,
      suggestedSqlName: suggestSqlName(table.name, []),
      publicParquetUrl: this.url(table.parquetUrl, provider.baseUrl).href,
      canonicalUrl: this.url(context.canonicalUrl, provider.baseUrl).href,
      observedAt: new Date().toISOString(),
      ...(context.updatedAt ? {modifiedAt: context.updatedAt} : {}),
      ...(context.license ? {license: context.license} : {}),
      schemaHint: {
        columns: table.columns.map((c) => ({
          name: c.name,
          logicalType: c.type,
          nullable: c.nullable ?? true,
          roles: c.roles,
          metadata: {},
          ...(c.description ? {description: c.description} : {}),
        })),
        metadata: {},
      },
      ...(Number.isSafeInteger(table.rowCountEstimate) && table.rowCountEstimate! >= 0
        ? {estimatedRows: String(table.rowCountEstimate)}
        : {}),
      ...(table.sizeBytes === undefined ? {} : {estimatedBytes: table.sizeBytes}),
    }));
  }
  async fetch(url: string, signal: AbortSignal, expected?: DatasetVersion) {
    const response = await this.response(url, signal, 'parquet');
    if (!response.body) throw new AppFailure('SOURCE_UNAVAILABLE', 'Leere Parquetantwort.');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const hash = await hashStream(
      response.body,
      signal,
      this.config.limits.importFileBytes,
      async (chunk) => {
        chunks.push(new Uint8Array(chunk));
      },
    );
    const etag = response.headers.get('etag'),
      lastModified = response.headers.get('last-modified');
    if (
      expected &&
      ((expected.evidence.kind === 'sha256' && expected.evidence.value !== hash.sha256) ||
        (expected.backing.kind === 'public-parquet' &&
          expected.backing.etag &&
          expected.backing.etag !== etag))
    )
      throw new AppFailure(
        'SOURCE_CHANGED',
        'SOURCE_CHANGED: Externer Stand geändert. Bitte ausdrücklich als neue Version hinzufügen.',
      );
    return {
      bytes: new Uint8Array(await new Blob(chunks).arrayBuffer()),
      sha256: hash.sha256,
      ...(etag ? {etag} : {}),
      ...(lastModified ? {lastModified} : {}),
    };
  }
}
