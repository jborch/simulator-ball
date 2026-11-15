import { describe, expect, test } from 'vitest';
import { LINE } from '../sim/config';
import { LineHost } from '../server/host';
import { describeCatchAi } from '../view/catchaiStatus';
import { CatchAiApi, networkError, type FetchFn } from './api';
import { Reporter } from './reporter';

const URL = 'https://catch.example';

/** Reporter against a server that always fails the same way. */
async function failing(fetchFn: FetchFn, now = 1_000_000) {
  let t = now;
  const r = new Reporter(new CatchAiApi(URL, 'key', fetchFn), LINE, null, { now: () => t, retryMinMs: 4000 });
  await r.tick();
  return { r, advance: (ms: number) => (t += ms) };
}

const dnsFailure: FetchFn = async () => {
  throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND catch.example'), { code: 'ENOTFOUND' }) });
};
const answer =
  (status: number, body = ''): FetchFn =>
  async () =>
    new Response(body, { status });

describe('reporting problems', () => {
  test('no answer at all is "no connection", with a readable reason and a retry countdown', async () => {
    const { r, advance } = await failing(dnsFailure);
    const s = r.status();
    expect(s.state).toBe('error');
    expect(s.problem).toMatchObject({ kind: 'unreachable', status: 0, since: 1_000_000, retryInMs: 4000 });
    advance(1500);
    const view = describeCatchAi(r.status(), 1_001_500);
    expect(view.chip).toBe('no connection');
    expect(view.alert?.title).toBe('No connection to CATCH.AI');
    expect(view.alert?.detail).toBe(`The server can’t reach ${URL}: host name not found (DNS).`);
    expect(view.alert?.hint).toContain('Retrying in 3 s.');
  });

  test('keeps "since" while the same problem goes on, and clears it on recovery', async () => {
    let down = true;
    const fetchFn: FetchFn = async (input, init) => (down ? dnsFailure(input, init) : new Response('[]', { status: 200 }));
    const { r, advance } = await failing(fetchFn);
    advance(10_000);
    await r.tick();
    expect(r.status().problem?.since).toBe(1_000_000);
    down = false;
    advance(60_000);
    await r.tick();
    expect(r.status().problem).toBeNull();
    expect(describeCatchAi(r.status()).alert).toBeNull();
  });

  test('a rejected key and a server error read differently', async () => {
    const auth = describeCatchAi((await failing(answer(401))).r.status());
    expect(auth.chip).toBe('key rejected');
    expect(auth.alert?.detail).toBe(`${URL} answered HTTP 401 Unauthorized.`);
    expect(auth.alert?.hint).toContain('CATCHAI_API_KEY');

    const down = describeCatchAi((await failing(answer(503, '{"detail":"maintenance"}'))).r.status());
    expect(down.chip).toBe('server error');
    expect(down.alert?.detail).toBe(`${URL} answered HTTP 503 Service Unavailable: maintenance.`);

    const html = describeCatchAi((await failing(answer(502, '<!doctype html><html>…</html>'))).r.status());
    expect(html.alert?.detail).toBe(`${URL} answered HTTP 502 Bad Gateway.`);
  });

  test('turning reporting on without an API key says so instead of trying', () => {
    const host = new LineHost({ catchai: { url: URL, enabled: true } });
    const view = describeCatchAi(host.reportingStatus());
    expect(view.chip).toBe('not configured');
    expect(view.alert?.hint).toContain('CATCHAI_API_KEY');
    host.setReporting(false);
    expect(host.reportingStatus()).toBeNull();
  });

  test('a server with authentication off (CATCHAI_AUTH=none) needs no API key', () => {
    const host = new LineHost({ catchai: { url: URL, noAuth: true, enabled: true } });
    const status = host.reportingStatus();
    expect(status).not.toBeNull();
    expect(describeCatchAi(status).chip).not.toBe('not configured');
    host.setReporting(false);
    expect(host.reportingStatus()).toBeNull();
  });

  test('nothing to show when reporting is off or fine', () => {
    expect(describeCatchAi(null)).toEqual({ chip: '', alert: null });
    expect(describeCatchAi({ state: 'connecting' })).toEqual({ chip: 'connecting…', alert: null });
    expect(describeCatchAi({ state: 'ok', problem: null })).toEqual({ chip: '', alert: null });
  });

  test('network errors are named by their cause', () => {
    const err = (code: string, message = code) => new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
    expect(networkError(err('ECONNREFUSED'))).toBe('connection refused');
    expect(networkError(err('UND_ERR_CONNECT_TIMEOUT'))).toBe('connection timed out');
    expect(networkError(err('CERT_HAS_EXPIRED', 'certificate has expired'))).toBe('TLS/certificate problem (certificate has expired)');
    expect(networkError(new DOMException('aborted', 'TimeoutError'))).toBe('no answer within 30 s');
  });
});
