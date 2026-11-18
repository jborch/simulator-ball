// Turns sim events into CATCH.AI payloads. Pure apart from its small memory of used timestamps.
import type { SimEvent } from '../sim/types';
import { EVENT, PROPERTY, STATION_EVENTS, type Catalogue } from './catalogue';
import type { Setup } from './setup';
import { ItemResult, type DeviceData, type ItemProcessed, type ItemsMerged } from './types';

export type Outbound =
  | { k: 'processed'; v: ItemProcessed }
  | { k: 'merged'; v: ItemsMerged }
  | { k: 'data'; v: DeviceData }
  | { k: 'batch'; name: string; state: 'started' | 'completed'; at: string };

const iso = (ms: number) => new Date(Math.round(ms)).toISOString();

/**
 * The server keeps one item record per (process, timestamp) and silently drops the rest, and the
 * same goes for device data per (device, timestamp). Parts placed in the same cycle share a
 * timestamp, so each key gets the next free millisecond.
 */
class UniqueTimes {
  private readonly used = new Map<string, Set<number>>();

  take(key: string, ms: number): number {
    let set = this.used.get(key);
    if (!set) this.used.set(key, (set = new Set()));
    let t = Math.round(ms);
    while (set.has(t)) t++;
    set.add(t);
    // Only recent times can collide; forget the oldest.
    if (set.size > 256) set.delete(set.values().next().value!);
    return t;
  }
}

export class Mapper {
  private readonly times = new UniqueTimes();

  constructor(
    private readonly cat: Catalogue,
    private readonly keys: Setup,
  ) {}

  /** Scoped id as reported: this session's ids continue after what's already in the scope. */
  id(simId: number): number {
    return this.keys.scopedIdBase + simId;
  }

  map(e: SimEvent): Outbound[] {
    const scope = this.cat.line;
    switch (e.kind) {
      case 'processed': {
        const from = this.times.take(`i:${e.process}`, e.from);
        const v: ItemProcessed = {
          Scope: scope,
          ScopedId: this.id(e.scopedId),
          Process: e.process,
          From: iso(from),
          To: iso(Math.max(from, e.to)),
          ItemType: e.itemType,
        };
        if (e.identifier) v.ItemIdentifier = e.identifier;
        if (e.carrier) v.CarrierIdentifier = e.carrier;
        if (e.result) v.ItemResult = ItemResult[e.result];
        if (e.sourceScopedId !== undefined) {
          v.SourceItemScopedId = this.id(e.sourceScopedId);
          v.SourceItemType = e.sourceType;
          v.SourceItemPosition = e.sourcePosition;
        }
        const out: Outbound[] = [{ k: 'processed', v }];
        if (e.properties) {
          const props = this.properties({ [PROPERTY.scopedId]: v.ScopedId, ...e.properties });
          out.push({ k: 'data', v: { DeviceId: e.process, Logged: iso(this.times.take(`d:${e.process}`, e.to)), Properties: props } });
        }
        return out;
      }
      case 'merged':
        return [
          {
            k: 'merged',
            v: {
              Scope: scope,
              Process: e.process,
              TargetItemScopedId: this.id(e.target),
              TargetItemType: e.targetType,
              SourceItemScopedId: this.id(e.source),
              SourceItemType: e.sourceType,
              SourceItemPosition: e.position,
              Logged: iso(this.times.take(`i:${e.process}`, e.logged)),
            },
          },
        ];
      case 'machine':
        return [
          this.data(this.cat.line, e.logged, { [EVENT.machineState]: e.state }, { [PROPERTY.machineState]: e.state }),
        ];
      case 'command':
        return [this.data(this.cat.line, e.logged, { [EVENT.command]: `${e.command} from ${e.origin}${e.accepted ? '' : ' (rejected)'}` })];
      case 'station': {
        const text = e.carrier ? `${e.message} (mover ${e.carrier})` : e.message;
        return [this.data(e.process, e.logged, { [STATION_EVENTS[e.code].Name]: text })];
      }
      case 'series': {
        // One device data row per sample, like the original's snap curve; the first carries the start event.
        const names = Object.keys(e.values);
        const n = e.values[names[0]].length;
        return Array.from({ length: n }, (_, i) =>
          this.data(e.process, e.start + i * e.interval, i === 0 ? { [e.startEvent]: `ID: ${this.id(e.scopedId)}` } : {}, Object.fromEntries(names.map((k) => [k, e.values[k][i]]))),
        );
      }
      case 'batch': {
        const text = e.state === 'started' ? `${e.name}: target ${e.target}` : `${e.name}: ${e.good} good, ${e.rejected} rejected`;
        const name = e.state === 'started' ? EVENT.batchStarted : EVENT.batchCompleted;
        return [
          { k: 'batch', name: e.name, state: e.state, at: iso(e.logged) },
          this.data(this.cat.line, e.logged, { [name]: text }),
        ];
      }
    }
  }

  private data(device: string, ms: number, events: Record<string, string>, props?: Record<string, string | number | boolean>): Outbound {
    const v: DeviceData = { DeviceId: device, Logged: iso(this.times.take(`d:${device}`, ms)) };
    const ev: Record<string, string> = {};
    for (const [name, value] of Object.entries(events)) {
      const key = this.keys.events[name];
      if (key) ev[key] = value;
    }
    if (Object.keys(ev).length) v.Events = ev;
    if (props) v.Properties = this.properties(props);
    return { k: 'data', v };
  }

  /** Property names → keys; unknown names and missing values are left out. */
  private properties(named: Record<string, number | string | boolean | null>): Record<string, number | string | boolean> {
    const out: Record<string, number | string | boolean> = {};
    for (const [name, value] of Object.entries(named)) {
      const key = this.keys.properties[name];
      if (key && value !== null && !(typeof value === 'number' && !Number.isFinite(value))) out[key] = value;
    }
    return out;
  }
}
