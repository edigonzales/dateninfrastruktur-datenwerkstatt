import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import type {Plugin, Connect} from 'vite';
/** These are compressed FILE FORMATS. Content-Encoding would make fetch/XHR decompress twice. */
function handler(root: string, base: string): Connect.NextHandleFunction {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://local.invalid').pathname;
    if (!path.startsWith(`${base}vendor/`) || !/[.](?:gz|tgz)$/.test(path)) return next();
    let file: string;
    try {
      file = resolve(root, decodeURIComponent(path.slice(base.length)));
    } catch {
      response.statusCode = 400;
      response.end();
      return;
    }
    if (!file.startsWith(resolve(root) + sep)) {
      response.statusCode = 403;
      response.end();
      return;
    }
    void stat(file).then(
      (info) => {
        if (!info.isFile()) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.statusCode = 200;
        response.removeHeader('Content-Encoding');
        response.setHeader('Content-Type', 'application/gzip');
        response.setHeader('Content-Length', info.size);
        response.setHeader('Cache-Control', 'no-cache');
        if (request.method === 'HEAD') response.end();
        else
          createReadStream(file)
            .on('error', () => response.destroy())
            .pipe(response);
      },
      () => {
        response.statusCode = 404;
        response.end();
      },
    );
  };
}
export function runtimeArchives(): Plugin {
  return {
    name: 'opaque-runtime-archives',
    configureServer(server) {
      server.middlewares.use(handler(server.config.publicDir, server.config.base));
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        handler(resolve(server.config.root, server.config.build.outDir), server.config.base),
      );
    },
  };
}
