import {createServer} from 'vite';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
// Dedicated local test origin. Never modifies the production runtime config.
const config = JSON.parse(await readFile('public/runtime-config.json', 'utf8'));
config.buildId = 'safari-pilot-test-only';
config.portalProviders = [
  {id: 'fixture', title: 'Synthetisches Testportal', baseUrl: 'http://127.0.0.1:4174/portal/'},
];
config.allowedDataOrigins = ['http://127.0.0.1:4174'];
const reports = new Map();
const server = await createServer({
  configFile: 'vite.config.ts',
  server: {host: '127.0.0.1', port: 4184, strictPort: true},
  plugins: [
    {
      name: 'safari-pilot-only',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = new URL(req.url ?? '/', 'http://127.0.0.1:4184').pathname;
          if (path === '/runtime-config.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(config));
          } else if (path === '/__safari/report' && req.method === 'POST') {
            if (req.headers.origin !== 'http://127.0.0.1:4184') {
              res.writeHead(403);
              res.end();
              return;
            }
            try {
              const chunks = [];
              let length = 0;
              for await (const chunk of req) {
                length += chunk.length;
                if (length > 2_000_000) throw Error('Report too large');
                chunks.push(chunk);
              }
              const value = JSON.parse(Buffer.concat(chunks).toString());
              if (
                !value ||
                typeof value !== 'object' ||
                !/^[a-f0-9-]{36}$/.test(value.id) ||
                !Array.isArray(value.checks)
              )
                throw Error('Invalid report');
              await mkdir('docs/verification', {recursive: true});
              await writeFile(
                `docs/verification/p8-safari-native-${value.id}.json`,
                JSON.stringify(value, null, 2),
              );
              reports.set(value.id, value);
              res.end('recorded');
            } catch (error) {
              res.writeHead(400);
              res.end(String(error));
            }
          } else if (path === '/__safari/reports') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify([...reports.values()]));
          } else next();
        });
      },
    },
  ],
});
await server.listen();
console.log('Safari pilot only: http://127.0.0.1:4184/tests/safari/index.html');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
