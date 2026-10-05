import { afterEach, describe, expect, it } from 'vitest';
import { TimeSync, parseUtc } from './timesync';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

describe('parseUtc', () => {
  it('parses .NET 7-digit fractions with sub-ms precision', () => {
    expect(parseUtc('2026-10-05T12:00:00.1234567Z')).toBeCloseTo(Date.UTC(2026, 9, 5, 12) + 123.4567, 4);
  });

  it('treats a missing zone as UTC and honours explicit offsets', () => {
    expect(parseUtc('2026-10-05T12:00:00')).toBe(Date.UTC(2026, 9, 5, 12));
    expect(parseUtc('2026-10-05T14:00:00+02:00')).toBe(Date.UTC(2026, 9, 5, 12));
  });

  it('rejects garbage', () => {
    expect(() => parseUtc('yesterday')).toThrow();
  });
});

describe('TimeSync', () => {
  let ts: TimeSync | null = null;
  afterEach(() => ts?.disconnect());

  it('uses the local clock when not connected', () => {
    ts = new TimeSync(memoryStorage(), async () => new Response(), () => 0);
    expect(Math.abs(ts.now() - Date.now())).toBeLessThan(50);
    expect(ts.state).toBe('off');
  });

  it('keeps the offset from the sample with the shortest round trip', async () => {
    const serverAhead = 1_000_000;
    let t = 0;
    let call = 0;
    // Fast sample is symmetric; slow samples stamp at the start, so their midpoint guess is 50 ms off.
    const fetchFn = async () => {
      const fast = call++ === 2;
      const before = fast ? 5 : 0;
      const after = fast ? 5 : 100;
      t += before;
      const body = JSON.stringify({ utc: new Date(t + serverAhead).toISOString() });
      t += after;
      return new Response(body);
    };
    ts = new TimeSync(memoryStorage(), fetchFn, () => t);
    await ts.connect('http://clock/api/time');

    expect(ts.state).toBe('synced');
    expect(ts.status().rttMs).toBe(10);
    expect(ts.now()).toBe(t + serverAhead);
  });

  it('keeps the last good offset when a resync fails', async () => {
    let t = 0;
    let up = true;
    const fetchFn = async () => {
      if (!up) throw new Error('down');
      return new Response(JSON.stringify({ Utc: new Date(t + 5000).toISOString() }));
    };
    ts = new TimeSync(memoryStorage(), fetchFn, () => t);
    await ts.connect('http://clock/api/time');
    up = false;
    expect(await ts.sync()).toBe(false);
    expect(ts.state).toBe('error');
    expect(ts.now()).toBe(t + 5000);
  });

  it('remembers the url and restores it', async () => {
    const storage = memoryStorage();
    ts = new TimeSync(storage, async () => new Response(JSON.stringify({ utc: '2026-10-05T12:00:00Z' })), () => 0);
    await ts.connect('http://clock/api/time');
    ts.disconnect();
    expect(storage.getItem('timesync.url')).toBeNull();

    storage.setItem('timesync.url', 'http://clock/api/time');
    ts.restore();
    expect(ts.status().url).toBe('http://clock/api/time');
  });
});
