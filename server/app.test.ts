import http, { type IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without type declarations
import { createApp } from './app.js';

let dist: string;
let base: string;
let close: () => void;
const upstreamCalls: { url: string; init: RequestInit & { headers: Headers } }[] = [];

beforeAll(async () => {
  dist = mkdtempSync(path.join(tmpdir(), 'sim-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>sim</title>');
  writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("x");'.repeat(200));
  writeFileSync(path.join(dist, '..', 'secret.txt'), 'nope');

  const fakeFetch = async (url: string, init: RequestInit & { headers: Headers }) => {
    const body = init.body ? await new Response(init.body).text() : '';
    upstreamCalls.push({ url, init });
    return new Response(JSON.stringify({ echo: body }), { status: 201, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' } });
  };
  const server = createApp({ distDir: dist, catchaiUrl: 'https://catch.example/', catchaiApiKey: 'k3y', fetch: fakeFetch });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => {
  close();
  rmSync(dist, { recursive: true, force: true });
  rmSync(path.join(dist, '..', 'secret.txt'), { force: true });
});

describe('production server', () => {
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

  it('does not serve files outside dist', async () => {
    expect((await fetch(`${base}/..%2fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('reports whether the CATCH.AI proxy has a key', async () => {
    expect(await (await fetch(`${base}/config.json`)).json()).toEqual({ catchaiProxy: true });
  });

  it('proxies /catchai with the API key added and client credentials stripped', async () => {
    const res = await fetch(`${base}/catchai/api/v1/items?x=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'client-key', cookie: 'session=1' },
      body: '{"a":1}',
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(await res.json()).toEqual({ echo: '{"a":1}' });
    const call = upstreamCalls.at(-1)!;
    expect(call.url).toBe('https://catch.example/api/v1/items?x=1');
    expect(call.init.headers.get('x-api-key')).toBe('k3y');
    expect(call.init.headers.get('cookie')).toBeNull();
    expect(call.init.headers.get('content-type')).toBe('application/json');
  });

  it('rejects writes outside the proxy', async () => {
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

/** GET without fetch()'s automatic decompression. */
function rawGet(url: string, headers: Record<string, string>): Promise<{ headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
