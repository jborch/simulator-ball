// Checks messages from viewers before they reach the simulation. Anything that doesn't match
// the protocol exactly is dropped, so a bad or hostile client can't crash the host.
import { ACCEPTS } from '../sim/commands';
import { INCIDENT_KINDS, type IncidentKind } from '../sim/incidents';
import type { Command, ToHost } from '../sim/protocol';
import { LIGHTINGS, type Lighting } from '../sim/types';

const MAX_ORIGIN = 64;
const MAX_TARGET = 64;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseToHost(text: string): ToHost | null {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(msg)) return null;
  switch (msg.type) {
    case 'command': {
      const command = parseCommand(msg.command);
      if (!command) return null;
      const origin = typeof msg.origin === 'string' && msg.origin.trim() ? msg.origin.trim().slice(0, MAX_ORIGIN) : 'viewer';
      return { type: 'command', command, origin };
    }
    case 'snapshot':
      return { type: 'snapshot' };
    case 'catchai':
      return typeof msg.enabled === 'boolean' ? { type: 'catchai', enabled: msg.enabled } : null;
    default:
      return null;
  }
}

function parseCommand(c: unknown): Command | null {
  if (!isObj(c) || typeof c.type !== 'string' || !Object.hasOwn(ACCEPTS, c.type)) return null;
  switch (c.type) {
    case 'speed':
      return finite(c.percent) ? { type: 'speed', percent: c.percent } : null;
    case 'batchSize':
      return finite(c.size) && c.size >= 1 && c.size <= 1_000_000 ? { type: 'batchSize', size: c.size } : null;
    case 'autoBatch':
      return typeof c.on === 'boolean' ? { type: 'autoBatch', on: c.on } : null;
    case 'fault':
      return typeof c.target === 'string' && c.target.length <= MAX_TARGET ? { type: 'fault', target: c.target } : null;
    case 'incident': {
      if (!(INCIDENT_KINDS as readonly unknown[]).includes(c.kind)) return null;
      if (c.station !== undefined && (typeof c.station !== 'string' || c.station.length > MAX_TARGET)) return null;
      return { type: 'incident', kind: c.kind as IncidentKind, ...(c.station ? { station: c.station as string } : {}) };
    }
    case 'scene': {
      if (c.lighting !== undefined && !(LIGHTINGS as unknown[]).includes(c.lighting)) return null;
      if (c.seed !== undefined && !(finite(c.seed) && Number.isInteger(c.seed) && c.seed >= 0 && c.seed <= 0xffffffff)) return null;
      return { type: 'scene', ...(c.lighting ? { lighting: c.lighting as Lighting } : {}), ...(c.seed !== undefined ? { seed: c.seed as number } : {}) };
    }
    default:
      return { type: c.type as Exclude<Command['type'], 'speed' | 'batchSize' | 'autoBatch' | 'fault' | 'incident' | 'scene'> };
  }
}
