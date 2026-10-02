import { describe, expect, it } from 'vitest';
import { CatchAiClient, type FetchFn } from './client';
import { seed } from './seed';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(existing: { devices: unknown[]; properties: unknown[]; events: unknown[] }) {
  const calls: Call[] = [];
  const fn: FetchFn = async (url, init) => {
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url,
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const path = url.replace('http://api', '');
    const map: Record<string, unknown[]> = {
      '/api/device': existing.devices,
      '/api/property': existing.properties,
      '/api/event': existing.events,
    };
    const body = method === 'GET' ? map[path] : {};
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fn, calls };
}

const props = [
  { Key: 'p600', Name: 'HeadY', Type: 'Float' as const },
  { Key: 'p601', Name: 'ShotAngle', Type: 'Float' as const },
];
const events = [{ Key: 'e600', Name: 'BallFired' }];

describe('seed', () => {
  it('creates only missing device, properties and events', async () => {
    const { fn, calls } = fakeFetch({ devices: [], properties: [{ Key: 'p600' }], events: [] });
    const created = await seed(new CatchAiClient('http://api/', 'secret', fn), 'BallSim1', props, events);

    const posts = calls.filter((c) => c.method === 'POST');
    expect(created).toBe(3);
    expect(posts.map((c) => c.url)).toEqual(['http://api/api/device', 'http://api/api/property', 'http://api/api/event']);
    expect(posts[0].body).toEqual({ DeviceId: 'BallSim1', Name: 'BallSim1' });
    expect(posts[1].body).toMatchObject({ Key: 'p601' });
    expect(posts[2].body).toMatchObject({ Key: 'e600', Name: 'BallFired', IsDisabled: false });
  });

  it('creates nothing when everything exists', async () => {
    const { fn, calls } = fakeFetch({
      devices: [{ DeviceId: 'BallSim1' }],
      properties: [{ Key: 'p600' }, { Key: 'p601' }],
      events: [{ Key: 'e600' }],
    });
    expect(await seed(new CatchAiClient('http://api', 'secret', fn), 'BallSim1', props, events)).toBe(0);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('sends the api key header', async () => {
    const { fn, calls } = fakeFetch({ devices: [], properties: [], events: [] });
    await new CatchAiClient('http://api', 'secret', fn).getDevices();
    expect(calls[0].headers['x-api-key']).toBe('secret');
  });

  it('surfaces the error detail on failure', async () => {
    const fn: FetchFn = async () => new Response(JSON.stringify({ detail: 'bad key' }), { status: 401 });
    await expect(new CatchAiClient('http://api', 'x', fn).getDevices()).rejects.toThrow(/401 bad key/);
  });
});
