import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
export function caddyConfig(config) {
  const base = config.appBasePath;
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw Error('Invalid deployment base path');
  const origins = [...new Set(config.allowedDataOrigins)];
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol))
      throw Error('CSP requires literal data origins');
  }
  const policy = `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' blob: ${origins.join(' ')}; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
  return `{
  admin off
  auto_https off
  persist_config off
}
:8080 {
  root * /srv
  header {
    X-Content-Type-Options nosniff
    Referrer-Policy no-referrer
    ${config.runtimes.webRChannel === 'auto' ? 'Cross-Origin-Opener-Policy same-origin\n    Cross-Origin-Embedder-Policy require-corp' : ''}
    Cross-Origin-Resource-Policy same-origin
  }
  @rWorker path ${base}vendor/webr/0.6.0/webr-worker.js
  @mainPolicy not path ${base}vendor/webr/0.6.0/webr-worker.js
  header @mainPolicy Content-Security-Policy "${policy}"
  header @rWorker Content-Security-Policy "${policy.replace("script-src 'self' 'wasm-unsafe-eval'", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'")}"
  @dynamic not path ${base}assets/* ${base}vendor/*
  header @dynamic Cache-Control no-cache
  @immutable path ${base}assets/* ${base}vendor/*
  header @immutable Cache-Control "public, max-age=31536000, immutable"
  ${base === '/' ? '' : `redir ${base.slice(0, -1)} ${base} 308`}
  ${base === '/' ? 'handle' : `handle_path ${base}*`} {
    route {
      @navigation path_regexp navigation ^/(|workspaces(/[^/.]+(/(data|sql/[^/.]+|r/[^/.]+))?)?/?|settings/?|open/?)$
      rewrite @navigation /index.html
      file_server
    }
  }
  ${base === '/' ? '' : 'handle {\n    respond "Not Found" 404\n  }'}
}
`;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const config = JSON.parse(
    await readFile(process.env.RUNTIME_CONFIG_FILE ?? 'public/runtime-config.json', 'utf8'),
  );
  config.appBasePath = process.env.APP_BASE_PATH ?? '/';
  config.buildId = process.env.BUILD_ID ?? 'local-pilot-not-released';
  config.runtimes.webRChannel = process.env.WEBR_CHANNEL ?? 'post-message';
  if (!['post-message', 'auto'].includes(config.runtimes.webRChannel))
    throw Error('Invalid channel');
  for (const key of ['webRBaseUrl', 'webRPackageRepoUrl', 'packageLockUrl'])
    config.runtimes[key] = config.runtimes[key].replace(/^\//, '');
  await writeFile('dist/runtime-config.json', JSON.stringify(config, null, 2) + '\n');
  await mkdir('deploy/generated', {recursive: true});
  await writeFile('deploy/generated/Caddyfile', caddyConfig(config));
}
