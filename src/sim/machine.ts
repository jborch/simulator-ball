// Small helpers shared by the PLC, the command handler and MES record building.
import type { LineConfig, StationDef } from './config';
import type { MachineState, SimEvent, SimState } from './types';

/** Wall-clock time (ms) of the current sim time. */
export function now(s: SimState): number {
  return s.epochMs + s.plant.t * 1000;
}

export function emit(s: SimState, e: SimEvent): void {
  s.mes.events.push(e);
}

/** Device id used in reports, e.g. "L07-ST20". */
export function processId(cfg: LineConfig, def: StationDef): string {
  return `${cfg.id}-${def.id}`;
}

/**
 * Process that supplies a station's parts: its bowl feeder (e.g. "L07-SPRINGS") or, for
 * cartridges, the station's own nest (e.g. "L07-ST40A-NEST"). Parts are reported there before
 * they are merged into the pen, so every process has one item per cycle.
 */
export function sourceProcessId(cfg: LineConfig, def: StationDef): string {
  return def.source === 'nest' ? `${processId(cfg, def)}-NEST` : feederId(cfg, def.source!);
}

/** Feeder device id, e.g. "L07-SPRINGS". */
export function feederId(cfg: LineConfig, id: string): string {
  return `${cfg.id}-${id.toUpperCase()}`;
}

/** Tray packing at the unload station: pens are merged into the tray here. */
export function trayProcessId(cfg: LineConfig): string {
  return `${cfg.id}-${cfg.layout.tray.station}-TRAY`;
}

/** Report name of an inspection measurement, e.g. "springAngle" → "Spring Angle". */
export function measurementName(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/** Mover number as printed on the mover, e.g. "07". */
export function carrierId(moverId: number): string {
  return String(moverId).padStart(2, '0');
}

export function setMachine(s: SimState, state: MachineState): void {
  if (s.plc.machine === state) return;
  s.plc.machine = state;
  s.plc.stateSince = s.plant.t;
  emit(s, { kind: 'machine', state, logged: now(s) });
}

function batchName(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export function startBatch(s: SimState): void {
  const plc = s.plc;
  const t = now(s);
  plc.batch = { name: batchName(t), target: plc.batchSize, loaded: 0, good: 0, rejected: 0, startedAt: t, state: 'running' };
  emit(s, { kind: 'batch', name: plc.batch.name, state: 'started', target: plc.batch.target, good: 0, rejected: 0, logged: t });
}
