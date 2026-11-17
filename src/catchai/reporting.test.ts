import { beforeAll, describe, expect, test } from 'vitest';
import type { LineConfig } from '../sim/config';
import { Simulation } from '../sim/simulation';
import { steadyConfig } from '../sim/testing';
import type { SimEvent } from '../sim/types';
import { CatchAiApi, type FetchFn } from './api';
import { catalogue } from './catalogue';
import { Mapper } from './mapper';
import { Reporter } from './reporter';
import { setup } from './setup';
import type { DeviceData, ItemProcessed, ItemsMerged, NamedPeriod } from './types';

const EPOCH = Date.UTC(2026, 10, 15, 8);

function run(seconds: number, mutate?: (c: LineConfig) => void): { cfg: LineConfig; events: SimEvent[]; sim: Simulation } {
  const cfg = steadyConfig((c) => {
    c.batch.size = 40;
    mutate?.(c);
  });
  const sim = new Simulation({ seed: 21, cfg, epochMs: EPOCH });
  sim.command({ type: 'start' });
  const events: SimEvent[] = [];
  for (let t = 0; t < seconds; t += 0.5) {
    sim.advance(0.5);
    if (Math.abs(t - 100) < 0.25) {
      sim.command({ type: 'fault', target: 'EM11-SPRING' });
      sim.command({ type: 'fault', target: 'springs' });
    }
    events.push(...sim.drainEvents());
  }
  return { cfg, events, sim };
}

/**
 * In-memory CATCH.AI with the behaviour the real server showed: p/e-numbered keys, items only
 * inside an open period of the scope's period type, one item record per (process, timestamp).
 */
class FakeServer {
  devices: { DeviceId: string; ParentDeviceId?: string }[] = [];
  processes: { DeviceId: string; Id: number; ItemType: string }[] = [];
  properties: { Key: string; Name: string; Mappings?: Record<string, string> }[] = [{ Key: 'p1', Name: 'Someone else' }];
  events: { Key: string; Name: string; Mappings?: Record<string, string> }[] = [{ Key: 'e7', Name: 'Someone else' }];
  periodTypes: { Id: number; Name: string }[] = [];
  itemViews: { Id: number; Name: string; Relations: unknown[] }[] = [];
  scopes: { Identifier: string; PeriodTypeId?: number }[] = [];
  periods: NamedPeriod[] = [];
  items: ItemProcessed[] = [];
  merges: ItemsMerged[] = [];
  data: DeviceData[] = [];
  /** Fail the next n bulk requests with 503. */
  outage = 0;
  calls: string[] = [];

  fetch: FetchFn = async (url, init) => {
    const method = init?.method ?? 'GET';
    const u = new URL(url, 'http://x');
    const path = u.pathname.replace(/^\/catchai/, '');
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    this.calls.push(`${method} ${path}`);
    const json = (data: unknown, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), { status });
    const list: Record<string, unknown[]> = {
      '/api/device': this.devices,
      '/api/process': this.processes,
      '/api/property': this.properties,
      '/api/event': this.events,
      '/api/period-type': this.periodTypes,
      '/api/scope': this.scopes,
      '/api/item-view': this.itemViews,
    };
    if (method === 'GET' && list[path]) return json(list[path]);
    if (method === 'POST' && ['/api/property', '/api/event'].includes(path)) {
      const coll = path === '/api/property' ? this.properties : this.events;
      if (!/^[pe]\d+$/.test(body.Key)) return json({ detail: 'bad key' }, 422);
      if (coll.some((x) => x.Key === body.Key)) return json({ detail: 'exists' }, 409);
      coll.push(body);
      return json(body);
    }
    if (method === 'POST' && path === '/api/device') return this.devices.push(body), json(body);
    if (method === 'POST' && path === '/api/process') return this.processes.push({ ...body, Id: this.processes.length + 1 }), json(body);
    if (method === 'POST' && path === '/api/period-type') {
      const t = { ...body, Id: this.periodTypes.length + 1 };
      this.periodTypes.push(t);
      return json(t);
    }
    if (method === 'POST' && path === '/api/scope') return this.scopes.push(body), json(body);
    if (method === 'POST' && path === '/api/item-view') return this.itemViews.push({ ...body, Id: this.itemViews.length + 1 }), json(body);
    if (method === 'GET' && path === '/api/item') {
      // Most recent first, by first appearance, like the real server.
      const scope = u.searchParams.get('scope');
      const first = new Map<number, ItemProcessed>();
      for (const i of this.items) if (i.Scope === scope && !first.has(i.ScopedId)) first.set(i.ScopedId, i);
      const recent = [...first.values()].sort((a, b) => b.From.localeCompare(a.From)).slice(0, Number(u.searchParams.get('maxTake') ?? 100));
      return json(recent.map((i) => ({ ScopedId: i.ScopedId, Scope: scope, Type: i.ItemType })));
    }
    if (method === 'GET' && path.startsWith('/api/period/active/')) {
      const open = this.periods.find((p) => !p.To);
      return open ? json(open) : json(undefined, 204);
    }
    if (method === 'POST' && path === '/api/period') {
      if (this.periods.some((p) => !p.To || p.To > body.From)) return json({ detail: 'overlap' }, 409);
      const p = { ...body, Id: this.periods.length + 1 };
      this.periods.push(p);
      return json(p);
    }
    if (method === 'PUT' && path.startsWith('/api/period/')) {
      const p = this.periods.find((x) => x.Id === Number(path.split('/').pop()))!;
      p.To = body.To;
      return json(p);
    }
    if (method === 'POST' && path.startsWith('/api/v2/')) {
      if (this.outage > 0) {
        this.outage--;
        return json({ detail: 'down' }, 503);
      }
      const invalid: { Index: number; Errors: { Code: number; Message: string }[] }[] = [];
      body.forEach((e: ItemProcessed & ItemsMerged & DeviceData, i: number) => {
        if (path !== '/api/v2/devicedata') {
          const at = e.From ?? e.Logged;
          const inPeriod = this.periods.some((p) => p.From <= at && (!p.To || p.To >= at));
          if (!inPeriod) return invalid.push({ Index: i, Errors: [{ Code: 1515, Message: 'No period' }] });
        }
        if (path === '/api/v2/item/processed') this.items.push(e);
        else if (path === '/api/v2/item/merge') this.merges.push(e);
        else this.data.push(e);
      });
      const res = { Total: body.length, Succeeded: body.length - invalid.length, Failed: invalid.length, InvalidEntries: invalid };
      return json(res, invalid.length === 0 ? 200 : invalid.length === body.length ? 422 : 207);
    }
    return json({ detail: `no route ${method} ${path}` }, 404);
  };
}

describe('CATCH.AI mapping', () => {
  let cfg: LineConfig;
  let events: SimEvent[];
  beforeAll(() => ({ cfg, events } = run(420)));

  test('every process and device the sim reports on is in the catalogue', () => {
    const cat = catalogue(cfg);
    const devices = new Set(cat.devices.map((d) => d.DeviceId));
    const processes = new Set(cat.processes.map((p) => p.DeviceId));
    for (const e of events) {
      if (e.kind === 'processed' || e.kind === 'merged') expect(processes, e.process).toContain(e.process);
      if (e.kind === 'station') expect(devices, e.process).toContain(e.process);
    }
    for (const p of processes) expect(devices).toContain(p);
    expect(events.some((e) => e.kind === 'station' && e.code === 'feederJam')).toBe(true);
  });

  test('items carry identifier and carrier, timestamps are unique per process, merges refer to reported items', () => {
    const cat = catalogue(cfg);
    const properties = Object.fromEntries(cat.properties.map((p, i) => [p.Name, `p${100 + i}`]));
    const evKeys = Object.fromEntries(cat.events.map((p, i) => [p.Name, `e${100 + i}`]));
    const m = new Mapper(cat, { properties, events: evKeys, batchTypeId: 1, scopedIdBase: 5000, created: 0, warnings: [] });
    const out = events.flatMap((e) => m.map(e));
    const items = out.flatMap((o) => (o.k === 'processed' ? [o.v] : []));
    const merges = out.flatMap((o) => (o.k === 'merged' ? [o.v] : []));
    const data = out.flatMap((o) => (o.k === 'data' ? [o.v] : []));

    const onMovers = new Set(cat.processes.filter((p) => p.HasCarrier).map((p) => p.DeviceId));
    const pens = items.filter((i) => i.ItemType === 'Pen');
    expect(pens.length).toBeGreaterThan(300);
    for (const p of pens) {
      expect(onMovers.has(p.Process)).toBe(true);
      expect(p.CarrierIdentifier).toMatch(/^\d\d$/);
      expect(p.ItemIdentifier).toMatch(/^\(01\)\d{14}\(17\)\d{6}\(10\)B\d{6}\(21\)[0-9A-Z]{12}$/);
      expect(p.ScopedId).toBeGreaterThan(5000);
    }
    // One pen keeps one identifier through the line.
    const byPen = new Map<number, Set<string>>();
    for (const p of pens) byPen.set(p.ScopedId, (byPen.get(p.ScopedId) ?? new Set()).add(p.ItemIdentifier!));
    for (const ids of byPen.values()) expect(ids.size).toBe(1);
    // Inspections report a result, using the server's codes (Failed 0, Passed 1).
    const em12 = items.filter((i) => i.Process === `${cfg.id}-UN01-EM12`);
    expect(new Set(em12.map((i) => i.ItemResult))).toEqual(new Set([0, 1]));

    const key = (process: string, t: string) => `${process}@${t}`;
    const itemTimes = [...items.map((i) => key(i.Process, i.From)), ...merges.map((x) => key(x.Process, x.Logged))];
    expect(new Set(itemTimes).size).toBe(itemTimes.length);
    const dataTimes = data.map((d) => key(d.DeviceId, d.Logged));
    expect(new Set(dataTimes).size).toBe(dataTimes.length);

    const reported = new Set(items.map((i) => i.ScopedId));
    const types = new Map(items.map((i) => [i.ScopedId, i.ItemType]));
    for (const x of merges) {
      expect(reported.has(x.SourceItemScopedId), `source ${x.SourceItemType} ${x.SourceItemScopedId}`).toBe(true);
      expect(types.get(x.SourceItemScopedId)).toBe(x.SourceItemType);
    }
    expect(new Set(merges.map((x) => x.SourceItemType))).toEqual(new Set(['Spring', 'SpringBase', 'Cartridge', 'Housing', 'Cap', 'Pen']));
    // Pens go into trays; the tray is reported when it leaves.
    const trays = items.filter((i) => i.ItemType === 'Tray');
    for (const x of merges.filter((x) => x.TargetItemType === 'Tray').slice(0, -12)) expect(trays.map((t) => t.ScopedId)).toContain(x.TargetItemScopedId);

    const allKeys = new Set([...Object.values(properties)]);
    for (const d of data) for (const k of Object.keys(d.Properties ?? {})) expect(allKeys).toContain(k);
    expect(data.some((d) => d.Events && Object.keys(d.Events).includes(evKeys['Feeder Jam']))).toBe(true);
  });
});

describe('Reporter', () => {
  test('sets up the line once, then reports a whole run with batches as periods', async () => {
    const server = new FakeServer();
    const { cfg, events, sim } = run(420);
    const api = new CatchAiApi('/catchai', undefined, server.fetch);
    const r = new Reporter(api, cfg, null, { now: () => EPOCH });
    r.push(events);
    for (let i = 0; i < 50 && r.status().queued > 0; i++) await r.tick();

    const st = r.status();
    expect(st.lastError).toBeNull();
    expect(st.state).toBe('ok');
    expect(st.queued).toBe(0);
    expect(st.rejected).toBe(0);
    expect(server.devices[0].DeviceId).toBe(cfg.id);
    // Line → units → equipment; every parent is created before its children.
    const units = server.devices.filter((d) => d.ParentDeviceId === cfg.id).map((d) => d.DeviceId);
    expect(units).toEqual(cfg.units.map((u) => `${cfg.id}-${u.id}`));
    server.devices.slice(1).forEach((d, i) => expect(server.devices.slice(0, i + 1).map((x) => x.DeviceId)).toContain(d.ParentDeviceId));
    expect(server.devices.slice(1 + units.length).every((d) => units.includes(d.ParentDeviceId!))).toBe(true);
    expect(server.scopes).toEqual([{ Identifier: cfg.id, DeviceId: cfg.id, PeriodTypeId: 1 }]);
    // The genealogy view covers every merge the line reports.
    const rel = new Set(server.itemViews[0].Relations.map((r) => JSON.stringify(r)));
    const pairs = server.itemViews[0].Relations.map((r) => JSON.stringify([(r as { SourceItemType: string }).SourceItemType, (r as { TargetItemType: string }).TargetItemType]));
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const x of server.merges) {
      const exact = JSON.stringify({ SourceItemType: x.SourceItemType, TargetItemType: x.TargetItemType, ProcessDeviceId: x.Process });
      const any = JSON.stringify({ SourceItemType: x.SourceItemType, TargetItemType: x.TargetItemType });
      expect(rel.has(exact) || rel.has(any), exact).toBe(true);
    }
    // New keys continue after the ones other systems use.
    expect(server.properties.find((p) => p.Mappings?.[cfg.id] === 'Mover Id')?.Key).toMatch(/^p([2-9]|\d\d+)$/);
    expect(server.events.filter((e) => e.Mappings?.[cfg.id]).every((e) => Number(e.Key.slice(1)) > 7)).toBe(true);

    const items = events.filter((e) => e.kind === 'processed').length;
    expect(server.items.length).toBe(items);
    expect(server.merges.length).toBe(events.filter((e) => e.kind === 'merged').length);
    const batches = events.filter((e) => e.kind === 'batch');
    expect(server.periods.length).toBe(batches.filter((b) => b.state === 'started').length);
    expect(server.periods.length).toBeGreaterThanOrEqual(2);
    expect(server.periods.filter((p) => !p.To).length).toBe(sim.state.plc.batch?.state === 'complete' ? 0 : 1);

    // A second session finds everything in place and continues the scoped ids.
    const before = server.calls.filter((c) => c.startsWith('POST /api/device') || c.startsWith('POST /api/process')).length;
    // Ids aren't in time order (a part's id is taken when it's placed, its From is the cycle start).
    server.items.splice(server.items.length - 5, 0, { ...server.items[0], ScopedId: 1e7, From: new Date(EPOCH).toISOString() });
    const keys = await setup(api, catalogue(cfg), EPOCH);
    expect(keys.created).toBe(0);
    expect(server.calls.filter((c) => c.startsWith('POST /api/device') || c.startsWith('POST /api/process')).length).toBe(before);
    expect(keys.scopedIdBase).toBe(1e7);
  });

  test('keeps data through an outage and sends it when the server is back', async () => {
    const server = new FakeServer();
    const { cfg, events } = run(60);
    let now = EPOCH;
    const r = new Reporter(new CatchAiApi('/catchai', undefined, server.fetch), cfg, null, { now: () => now, retryMinMs: 1000 });
    r.push(events.slice(0, 50));
    server.outage = 3;
    await r.tick();
    expect(r.status().state).toBe('error');
    r.push(events.slice(50));
    for (let i = 0; i < 20 && r.status().queued > 0; i++) {
      now += 60_000;
      await r.tick();
    }
    expect(r.status().queued).toBe(0);
    expect(r.status().rejected).toBe(0);
    expect(server.items.length).toBe(events.filter((e) => e.kind === 'processed').length);
  });

  test('opens a period for a batch already running when reporting starts, and closes a stale one', async () => {
    const server = new FakeServer();
    const { cfg, events, sim } = run(30);
    server.periodTypes.push({ Id: 1, Name: 'Assembly Batch' });
    server.periods.push({ Id: 1, TypeId: 1, DeviceId: cfg.id, Name: 'left open', From: new Date(EPOCH - 3600_000).toISOString() });
    const batch = sim.state.plc.batch!;
    // Reporting starts late: the batch's start event was missed.
    const r = new Reporter(new CatchAiApi('/catchai', undefined, server.fetch), cfg, batch, { now: () => EPOCH + 30_000 });
    r.push(events.filter((e) => e.kind !== 'batch'));
    for (let i = 0; i < 10 && r.status().queued > 0; i++) await r.tick();
    expect(server.periods[0].To).toBe(new Date(batch.startedAt).toISOString());
    expect(server.periods[1]).toMatchObject({ Name: batch.name, From: new Date(batch.startedAt).toISOString() });
    expect(r.status().rejected).toBe(0);
  });
});
