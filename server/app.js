// Production HTTP server: serves the built frontend (dist/) and proxies /catchai/* to CATCH.AI,
// adding the API key server-side (the same job the Vite dev proxy does in development).
// Plain Node, no dependencies. Entry point: server/index.js.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

export const DEFAULT_CATCHAI_URL = 'https://catchai-demo-axis-data.northeurope.cloudapp.azure.com';
export const CATCHAI_PREFIX = '/catchai';

const MIME = {
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

// Hop-by-hop headers (RFC 9110 §7.6.1) plus ones fetch() handles itself.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'host', 'content-length', 'accept-encoding', 'content-encoding',
]);

/**
 * @param {{
 *   distDir: string,
 *   catchaiUrl?: string,
 *   catchaiApiKey?: string,
 *   log?: (msg: string) => void,
 *   fetch?: typeof fetch,
 * }} opts
 */
export function createApp(opts) {
  const distDir = path.resolve(opts.distDir);
  const upstream = (opts.catchaiUrl || DEFAULT_CATCHAI_URL).replace(/\/+$/, '');
  const apiKey = opts.catchaiApiKey ?? '';
  const log = opts.log ?? (() => {});
  const doFetch = opts.fetch ?? fetch;
  /** Compressed copies of static files, keyed by `${file}:${mtime}:${encoding}`. dist/ is small. */
  const compressed = new Map();

  const runtimeConfig = JSON.stringify({ catchaiProxy: apiKey !== '' });

  async function serveStatic(req, res, urlPath) {
    let rel;
    try {
      rel = decodeURIComponent(urlPath);
    } catch {
      return send(res, 400, 'Bad request');
    }
    if (rel.includes('\0')) return send(res, 400, 'Bad request');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(distDir, rel);
    if (file !== distDir && !file.startsWith(distDir + path.sep)) return send(res, 404, 'Not found');

    let info;
    try {
      info = await stat(file);
    } catch {
      info = null;
    }
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
      return res.end();
    }

    const encoding = COMPRESSIBLE.has(ext) && info.size <= MAX_COMPRESS_BYTES ? pickEncoding(req.headers['accept-encoding']) : null;
    if (COMPRESSIBLE.has(ext)) res.setHeader('Vary', 'Accept-Encoding');
    if (encoding) {
      const key = `${file}:${info.mtimeMs}:${encoding}`;
      let body = compressed.get(key);
      if (!body) {
        const raw = await readFile(file);
        body = encoding === 'br'
          ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
          : zlib.gzipSync(raw, { level: 9 });
        compressed.set(key, body);
      }
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', body.length);
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(file), res);
  }

  async function proxy(req, res, url) {
    const target = upstream + url.pathname.slice(CATCHAI_PREFIX.length) + url.search;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(name) || name === 'x-api-key' || name === 'cookie' || name === 'origin' || name === 'referer') continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    if (apiKey) headers.set('x-api-key', apiKey);

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let upstreamRes;
    try {
      upstreamRes = await doFetch(target, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      log(`proxy ${req.method} ${target} failed: ${err instanceof Error ? err.message : String(err)}`);
      return send(res, 502, 'Bad gateway');
    }
    res.statusCode = upstreamRes.status;
    upstreamRes.headers.forEach((value, name) => {
      if (!HOP_BY_HOP.has(name) && name !== 'set-cookie') res.setHeader(name, value);
    });
    if (!upstreamRes.body || req.method === 'HEAD') return res.end();
    await pipeline(Readable.fromWeb(upstreamRes.body), res);
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    res.on('finish', () => log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === CATCHAI_PREFIX || url.pathname.startsWith(CATCHAI_PREFIX + '/')) return await proxy(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return send(res, 405, 'Method not allowed');
      }
      if (url.pathname === '/healthz') return send(res, 200, 'ok');
      if (url.pathname === '/config.json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.end(runtimeConfig);
      }
      return await serveStatic(req, res, url.pathname);
    } catch (err) {
      log(`error ${req.method} ${req.url}: ${err instanceof Error ? err.stack : String(err)}`);
      if (!res.headersSent) send(res, 500, 'Internal server error');
      else res.destroy();
    }
  });
  return server;
}

function send(res, status, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

/** Prefer brotli, then gzip, honouring q=0. */
function pickEncoding(header) {
  if (!header) return null;
  const accepted = new Map();
  for (const part of String(header).split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    accepted.set(name, q ? Number(q.slice(2)) : 1);
  }
  for (const enc of ['br', 'gzip']) if ((accepted.get(enc) ?? accepted.get('*') ?? 0) > 0) return enc;
  return null;
}
