import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from './http';

let root: string;
let base: string;
let server: http.Server;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'sim-http-'));
  const client = path.join(root, 'client');
  mkdirSync(path.join(client, 'assets'), { recursive: true });
  writeFileSync(path.join(client, 'index.html'), '<!doctype html><title>sim</title>');
  writeFileSync(path.join(client, 'assets', 'app-abc123.js'), 'console.log("x");'.repeat(200));
  writeFileSync(path.join(root, 'secret.txt'), 'nope');
  server = createHttpServer({ clientDir: client });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('HTTP server', () => {
  it('serves index.html at / without long caching', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>sim</title>');
  });

  it('serves hashed assets compressed and immutable, with ETag revalidation', async () => {
    const res = await rawGet(`${base}/assets/app-abc123.js`, { 'accept-encoding': 'gzip' });
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(gunzipSync(res.body).toString()).toContain('console.log');
    const again = await fetch(`${base}/assets/app-abc123.js`, { headers: { 'if-none-match': String(res.headers.etag) } });
    expect(again.status).toBe(304);
  });

  it('does not serve files outside the client directory', async () => {
    expect((await fetch(`${base}/..%2fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('answers health checks and rejects writes', async () => {
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

/** GET without fetch()'s automatic decompression. */
function rawGet(url: string, headers: Record<string, string>): Promise<{ headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}
