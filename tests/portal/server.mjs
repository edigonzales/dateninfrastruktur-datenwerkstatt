import {createServer} from 'node:http';
let parquet = Buffer.alloc(0),
  etag = '"v1"',
  issue = 'issue-2024',
  requests = [];
const namedFiles = new Map();
const testOrigins = new Set(
  [4173, 4180, 4181, 4182, 4183, 4184].map((port) => `http://127.0.0.1:${port}`),
);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1:4174').pathname;
  if (!path.includes('nocors') && testOrigins.has(req.headers.origin))
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range');
  res.setHeader('Access-Control-Expose-Headers', 'ETag,Last-Modified,Content-Length,Content-Range');
  if (req.method === 'OPTIONS') {
    res.end();
    return;
  }
  if (req.method === 'DELETE' && path.startsWith('/__namedfile/')) {
    namedFiles.delete(path.slice(13));
    res.end('removed');
    return;
  }
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (path === '/__file') parquet = body;
    if (path.startsWith('/__namedfile/')) namedFiles.set(path.slice(13), body);
    if (path === '/__reset') {
      etag = '"v1"';
      issue = 'issue-2024';
      requests = [];
    }
    if (path === '/__change') {
      etag = '"v2"';
      issue = 'issue-2025';
    }
    res.end('ok');
    return;
  }
  if (path === '/__requests') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(requests));
    return;
  }
  requests.push({path, cookie: req.headers.cookie ?? null, range: req.headers.range ?? null});
  if (path === '/health') {
    res.end('ready');
    return;
  }
  if (path.includes('redirect')) {
    res.writeHead(302, {Location: 'http://127.0.0.1:4174/portal/data.parquet'});
    res.end();
    return;
  }
  if (path.endsWith('.parquet')) {
    const namedKey = /\/datasets\/(proof-[a-z0-9-]+)\//.exec(path)?.[1];
    const bytes = namedKey ? namedFiles.get(namedKey) : parquet;
    if (!bytes) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.apache.parquet');
    // Named immutable fixtures remain independent of deliberate global ETag fault tests.
    res.setHeader('ETag', namedKey ? `"${namedKey}"` : etag);
    res.setHeader('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]),
        end = Math.min(Number(range[2] || bytes.length - 1), bytes.length - 1);
      res.writeHead(206, {'Content-Range': `bytes ${start}-${end}/${bytes.length}`});
      res.end(bytes.subarray(start, end + 1));
    } else res.end(bytes);
    return;
  }
  res.setHeader('Content-Type', path.includes('mime') ? 'text/html' : 'application/json');
  if (path.endsWith('/index.json')) {
    res.end(
      JSON.stringify({
        formatVersion: 1,
        providerId: 'fixture',
        generatedAt: '2026-10-04T00:00:00Z',
        entries: [
          {
            key: 'one',
            title: 'Synthetische Bevölkerung',
            target: {kind: 'dataset', entryId: 'bevoelkerung'},
          },
          {
            key: 'two',
            title: 'Synthetische Ausgabe',
            target: {kind: 'current-issue', seriesId: 'serie'},
          },
        ],
      }),
    );
    return;
  }
  if (path.includes('404')) {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  if (path.endsWith('/explore/context.json')) {
    const datasetId = path.includes('/series/')
      ? path.includes('/current/')
        ? issue
        : decodeURIComponent(path.split('/issues/')[1].split('/')[0])
      : decodeURIComponent(path.split('/datasets/')[1]?.split('/')[0] ?? 'bevoelkerung');
    const column = {name: 'gemeinde_id', type: 'VARCHAR', nullable: true, roles: ['identifier']};
    res.end(
      JSON.stringify({
        version: 4,
        datasetId,
        title: 'Synthetische Bevölkerung',
        canonicalUrl: path.includes('/series/')
          ? 'series/serie/issues/current'
          : `datasets/${datasetId}`,
        license: 'CC0 · synthetisch',
        execution: {
          engine: 'duckdb-wasm',
          mode: 'browser-local',
          maxPreviewRows: 999,
          maxResultRows: 999,
          queryTimeoutMs: 1,
        },
        catalogDatabase: {
          url: 'https://evil.invalid/catalog.duckdb',
          database: 'evil',
          schema: 'evil',
        },
        tables: path.includes('/empty/')
          ? []
          : [
              {
                id: 'main',
                name: 'portal_daten',
                title: '<img src=x onerror="globalThis.marker=1">',
                parquetUrl: datasetId.startsWith('proof-')
                  ? `datasets/${datasetId}/data.parquet`
                  : 'data.parquet',
                primary: true,
                columns: [column],
              },
              {
                id: 'second',
                name: 'zweite',
                title: 'Zweite Tabelle',
                parquetUrl: datasetId.startsWith('proof-')
                  ? `datasets/${datasetId}/data.parquet`
                  : 'data.parquet',
                primary: false,
                columns: [column],
              },
            ],
        recipes: [],
        chartsEnabled: true,
        webREnabled: true,
        rLaboratory: {
          dataFrameName: 'daten',
          runtimeBaseUrl: 'https://evil.invalid/',
          packageRepoUrl: 'https://evil.invalid/',
          packages: ['evil'],
          recommendedRows: 1,
          warningRows: 2,
          hardRows: 3,
          plotWidth: 4,
          plotHeight: 4,
        },
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end('{}');
});
server.listen(4174, '127.0.0.1');
