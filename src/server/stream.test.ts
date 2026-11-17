import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Frame, ToClient } from '../sim/protocol';
import type { SimEvent } from '../sim/types';
import { LineHost } from './host';
import { createHttpServer } from './http';
import { parseToHost } from './validate';
import { attachLineSocket } from './ws';

let host: LineHost;
let server: http.Server;
let url: string;

beforeAll(async () => {
  host = new LineHost({ seed: 7 });
  server = createHttpServer({ clientDir: '/nonexistent' });
  attachLineSocket(server, host, { exclusive: true });
  host.start();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  host.stop();
  server.closeAllConnections();
  server.close();
});

/** A viewer that records what it receives. */
async function viewer() {
  const ws = new WebSocket(`${url}/ws`);
  const msgs: ToClient[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString()) as ToClient));
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
  const frames = () => msgs.filter((m): m is Extract<ToClient, { type: 'frame' }> => m.type === 'frame').map((m) => m.frame);
  const events = () => msgs.flatMap((m) => (m.type === 'events' ? m.events : []));
  const until = async (ok: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const send = (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  return { ws, msgs, frames, events, until, send };
}

describe('streaming the line over WebSocket', () => {
  it('sends the current frame and reporting status on connect, then frames in real time', async () => {
    const v = await viewer();
    await v.until(() => v.frames().length >= 5);
    expect(v.msgs[0].type).toBe('frame');
    expect(v.msgs.some((m) => m.type === 'catchai' && m.status === null)).toBe(true);
    const ts = v.frames().map((f: Frame) => f.t);
    expect(ts.every((t, i) => i === 0 || t >= ts[i - 1])).toBe(true);
    expect(ts.at(-1)!).toBeGreaterThan(ts[0]);
    v.ws.close();
  });

  it('shares one line between viewers: a command from one is seen by the other', async () => {
    const a = await viewer();
    const b = await viewer();
    a.send({ type: 'command', command: { type: 'speed', percent: 55 }, origin: 'viewer-a' });
    await b.until(() => b.frames().some((f) => Math.abs(f.speedTarget - 0.55) < 1e-9));
    await b.until(() => b.events().some((e: SimEvent) => e.kind === 'command' && e.origin === 'viewer-a' && e.accepted));
    a.ws.close();
    b.ws.close();
  });

  it('ignores malformed messages and keeps running', async () => {
    const v = await viewer();
    v.send('not json');
    v.send({ type: 'command', command: { type: 'explode' } });
    v.send({ type: 'command', command: { type: 'speed', percent: 'fast' } });
    v.send({ type: 'catchai', enabled: 'yes' });
    const n = v.frames().length;
    await v.until(() => v.frames().length > n + 3);
    expect(v.ws.readyState).toBe(WebSocket.OPEN);
    v.ws.close();
  });

  it('refuses upgrades on other paths', async () => {
    const ws = new WebSocket(`${url}/other`);
    await expect(new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))).rejects.toThrow();
  });
});

describe('parseToHost', () => {
  it('accepts valid messages and normalises the origin', () => {
    expect(parseToHost('{"type":"command","command":{"type":"hold"},"origin":"  me "}')).toEqual({ type: 'command', command: { type: 'hold' }, origin: 'me' });
    expect(parseToHost('{"type":"command","command":{"type":"start"}}')).toEqual({ type: 'command', command: { type: 'start' }, origin: 'viewer' });
    expect(parseToHost('{"type":"command","command":{"type":"fault","target":"EM11-BODY"}}')?.type).toBe('command');
    expect(parseToHost('{"type":"catchai","enabled":false}')).toEqual({ type: 'catchai', enabled: false });
    expect(parseToHost('{"type":"snapshot"}')).toEqual({ type: 'snapshot' });
  });

  it('rejects anything else', () => {
    for (const bad of ['', '[]', 'null', '{"type":"command"}', '{"type":"command","command":{"type":"toString"}}', '{"type":"command","command":{"type":"batchSize","size":0}}', '{"type":"command","command":{"type":"speed","percent":null}}', '{"type":"nope"}']) {
      expect(parseToHost(bad), bad).toBeNull();
    }
  });
});
