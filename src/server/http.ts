// HTTP side of the server: the built frontend (production) or Vite's middleware (development),
// plus /healthz. The simulation itself is streamed over the WebSocket in ws.ts.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

export interface HttpOptions {
  /** Built frontend to serve. Ignored when `middleware` is given. */
  clientDir?: string;
  /** Handles everything except /healthz (Vite's dev middleware). */
  middleware?: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  log?: (msg: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.glb', '.gltf', '.txt', '.wasm']);
/** Files above this are streamed uncompressed instead of being compressed into memory. */
const MAX_COMPRESS_BYTES = 16 * 1024 * 1024;

export function createHttpServer(opts: HttpOptions): http.Server {
  const log = opts.log ?? (() => {});
  const clientDir = path.resolve(opts.clientDir ?? 'dist/client');
  /** Compressed copies of static files, keyed by `${file}:${mtime}:${encoding}`. The build is small. */
  const compressed = new Map<string, Buffer>();

  async function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<void> {
    let rel: string;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (rel.includes('\0')) return send(res, 400, 'Bad request');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(clientDir, rel);
    if (!file.startsWith(clientDir + path.sep)) return send(res, 404, 'Not found');

    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return send(res, 404, 'Not found');

    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', info.mtime.toUTCString());
    // Vite puts content-hashed files in /assets; everything else (index.html, models) must revalidate.
    res.setHeader('Cache-Control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    const encoding = COMPRESSIBLE.has(ext) && info.size <= MAX_COMPRESS_BYTES ? pickEncoding(req.headers['accept-encoding']) : null;
    if (COMPRESSIBLE.has(ext)) res.setHeader('Vary', 'Accept-Encoding');
    if (encoding) {
      const key = `${file}:${info.mtimeMs}:${encoding}`;
      let body = compressed.get(key);
      if (!body) {
        const raw = await readFile(file);
        body =
          encoding === 'br'
            ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
            : zlib.gzipSync(raw, { level: 9 });
        compressed.set(key, body);
      }
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', body.length);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(createReadStream(file), res);
  }

  return http.createServer(async (req, res) => {
    const started = Date.now();
    res.on('finish', () => log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`));
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/healthz') return send(res, 200, 'ok');
      if (opts.middleware) return opts.middleware(req, res, () => send(res, 404, 'Not found'));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return send(res, 405, 'Method not allowed');
      }
      await serveStatic(req, res, url.pathname);
    } catch (err) {
      log(`error ${req.method} ${req.url}: ${err instanceof Error ? err.stack : String(err)}`);
      if (!res.headersSent) send(res, 500, 'Internal server error');
      else res.destroy();
    }
  });
}

function send(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

/** Prefer brotli, then gzip, honouring q=0. */
function pickEncoding(header: string | undefined): 'br' | 'gzip' | null {
  if (!header) return null;
  const accepted = new Map<string, number>();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepted.set(name, q ? Number(q.slice(2)) : 1);
  }
  for (const enc of ['br', 'gzip'] as const) if ((accepted.get(enc) ?? accepted.get('*') ?? 0) > 0) return enc;
  return null;
}
