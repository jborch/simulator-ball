// Creates what the line needs in CATCH.AI before any data is sent: devices, the batch period type,
// the item scope, processes, properties and events. Idempotent: existing entries are reused.
import { ApiError, type CatchAiApi } from './api';
import type { Catalogue } from './catalogue';
import type { Device, EventDefinition, Item, ItemView, PeriodType, Process, PropertyDefinition, Scope } from './types';

export interface Setup {
  /** Property name → key ("p<n>"). */
  properties: Record<string, string>;
  /** Event name → key ("e<n>"). */
  events: Record<string, string>;
  batchTypeId: number;
  /** Highest scoped id already in the scope; this session's ids are reported on top of it. */
  scopedIdBase: number;
  created: number;
  /** Non-fatal setup problems. */
  warnings: string[];
}

/** How far back to look for the last reported item when continuing the scoped id sequence. */
const SCOPED_ID_LOOKBACK_MS = 90 * 24 * 3600_000;
/** Most recent items to look at; far more than a session has in flight (≈32 movers' worth of parts). */
const SCOPED_ID_SAMPLE = 5000;

const PROCESS_FIELDS = ['Scope', 'HasResult', 'HasCarrier', 'CarrierType', 'ItemType', 'SourceItemType'] as const;

export async function setup(api: CatchAiApi, cat: Catalogue, nowMs: number): Promise<Setup> {
  let created = 0;

  const devices = await api.get<Device[]>('/api/device');
  const known = new Set(devices.map((d) => d.DeviceId));
  // Parent first: the catalogue lists the line device before its children.
  for (const d of cat.devices) {
    if (known.has(d.DeviceId)) continue;
    await createIgnoringConflict(() => api.post('/api/device', d));
    created++;
  }

  const types = await api.get<PeriodType[]>('/api/period-type');
  let batchType = types.find((t) => t.Name === cat.batchPeriodType);
  if (!batchType) {
    batchType = await api.post<PeriodType>('/api/period-type', { Name: cat.batchPeriodType, DeviceIds: [cat.line], AllowOverlappingPeriods: false });
    created++;
  }

  const scopes = await api.get<Scope[]>('/api/scope');
  const scope = scopes.find((s) => s.Identifier === cat.line);
  const wantScope: Scope = { Identifier: cat.line, DeviceId: cat.line, PeriodTypeId: batchType.Id };
  if (!scope) {
    await api.post('/api/scope', wantScope);
    created++;
  } else if (scope.PeriodTypeId !== batchType.Id || scope.DeviceId !== cat.line) {
    await api.put(`/api/scope/${encodeURIComponent(cat.line)}`, wantScope);
  }

  const processes = await api.get<(Process & { Id: number })[]>('/api/process');
  for (const p of cat.processes) {
    const have = processes.find((x) => x.DeviceId === p.DeviceId);
    if (!have) {
      await createIgnoringConflict(() => api.post('/api/process', p));
      created++;
    } else if (PROCESS_FIELDS.some((k) => (have[k] ?? null) !== (p[k] ?? null))) {
      await api.put(`/api/process/${encodeURIComponent(p.DeviceId)}`, { ...have, ...p });
    }
  }

  // The genealogy view is a convenience for browsing; data still flows if it can't be made.
  const warnings: string[] = [];
  try {
    const views = await api.get<ItemView[]>('/api/item-view');
    const view = views.find((v) => v.Name === cat.itemView.Name);
    const relKey = (v: ItemView) => v.Relations.map((r) => `${r.SourceItemType}>${r.TargetItemType}@${r.ProcessDeviceId ?? ''}`).sort().join();
    if (!view) {
      await api.post('/api/item-view', cat.itemView);
      created++;
    } else if (relKey(view) !== relKey(cat.itemView)) {
      await api.put(`/api/item-view/${view.Id}`, { ...cat.itemView, Id: view.Id });
    }
  } catch (err) {
    if (err instanceof ApiError && err.transient) throw err;
    warnings.push(`item view: ${err instanceof Error ? err.message : String(err)}`);
  }

  const props = await ensureKeyed<PropertyDefinition>(api, '/api/property', 'p', cat.line, cat.properties.map((p) => ({ StoreInDatabase: true, ...p })));
  const events = await ensureKeyed<EventDefinition>(api, '/api/event', 'e', cat.line, cat.events);
  created += props.created + events.created;

  const q = new URLSearchParams({
    From: new Date(nowMs - SCOPED_ID_LOOKBACK_MS).toISOString(),
    To: new Date(nowMs + 3600_000).toISOString(),
    scope: cat.line,
    maxTake: String(SCOPED_ID_SAMPLE),
  });
  // Ids are handed out in order but not reported in that order (a part's id is taken when it is
  // placed, its record starts at the cycle start), so take the max over the recent items.
  const recent = (await api.get<Item[]>(`/api/item?${q}`)) ?? [];
  const scopedIdBase = recent.reduce((m, i) => Math.max(m, i.ScopedId), 0);

  return { properties: props.keys, events: events.keys, batchTypeId: batchType.Id, scopedIdBase, created, warnings };
}

/**
 * Properties and events have server-wide keys of the form "p12"/"e7", shared with other systems.
 * Ours are found by the line tag in Mappings; missing ones get the next free number.
 */
async function ensureKeyed<T extends { Key: string; Name: string; Mappings?: Record<string, string> }>(
  api: CatchAiApi,
  path: string,
  prefix: 'p' | 'e',
  line: string,
  wanted: Omit<T, 'Key' | 'Mappings'>[],
): Promise<{ keys: Record<string, string>; created: number }> {
  let existing = await api.get<T[]>(path);
  const keys: Record<string, string> = {};
  let created = 0;
  for (const w of wanted) {
    const mine = existing.find((x) => x.Mappings?.[line] === w.Name);
    if (mine) {
      keys[w.Name] = mine.Key;
      continue;
    }
    for (let attempt = 0; ; attempt++) {
      const next = 1 + Math.max(0, ...existing.map((x) => Number(x.Key.slice(1))).filter(Number.isFinite));
      const def = { ...w, Key: `${prefix}${next}`, Mappings: { [line]: w.Name } } as T;
      try {
        await api.post(path, def);
        existing = [...existing, def];
        keys[w.Name] = def.Key;
        created++;
        break;
      } catch (err) {
        // Someone else took the key meanwhile: reload and try the next one.
        if (!(err instanceof ApiError) || err.status !== 409 || attempt >= 3) throw err;
        existing = await api.get<T[]>(path);
      }
    }
  }
  return { keys, created };
}

async function createIgnoringConflict(create: () => Promise<unknown>): Promise<void> {
  try {
    await create();
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 409) throw err;
  }
}
