// Small helpers shared by the PLC, the command handler and MES record building.
import type { LineConfig, RobotDef, StationDef, Step, SubProcessDef } from './config';
import type { MachineState, SimEvent, SimState } from './types';

/** Wall-clock time (ms) of the current sim time. */
export function now(s: SimState): number {
  return s.epochMs + s.plant.t * 1000;
}

export function emit(s: SimState, e: SimEvent): void {
  s.mes.events.push(e);
}

/** Device id of a unit, e.g. "L07-UN01". */
export function unitId(cfg: LineConfig, unit: string): string {
  return `${cfg.id}-${unit}`;
}

/** Device id used in reports, e.g. "L07-UN01-EM12". */
export function processId(cfg: LineConfig, def: StationDef): string {
  return `${unitId(cfg, def.unit)}-${def.id}`;
}

/** Device id of a sub-line process (EM10, EM13), e.g. "L07-UN01-EM10". */
export function subProcessId(cfg: LineConfig, def: Pick<SubProcessDef, 'id' | 'unit'>): string {
  return `${unitId(cfg, def.unit)}-${def.id}`;
}

/** Device name in the original line's format, e.g. "L07-UN01-EM12 - Measure spring angle". */
export function deviceName(id: string, name: string): string {
  return `${id} - ${name}`;
}

/**
 * Process that supplies a robot's parts when its sub-line doesn't track them: its bowl feeder
 * (e.g. "L07-UN01-BODIES"). Tracked parts are reported where they are checked or made instead.
 */
export function sourceProcessId(cfg: LineConfig, _def: StationDef, robot: RobotDef): string {
  return feederId(cfg, robot.source!);
}

/** Feeder device id, e.g. "L07-UN01-SPRINGS". */
export function feederId(cfg: LineConfig, id: string): string {
  const f = cfg.feeders.find((x) => x.id === id)!;
  return `${unitId(cfg, f.unit)}-${id.toUpperCase()}`;
}

/** Tray packing at the unload station: pens are merged into the tray here. */
export function trayProcessId(cfg: LineConfig): string {
  return `${processId(cfg, stationById(cfg, cfg.layout.tray.station))}-TRAY`;
}

/**
 * Where a station reports the pens it drops in its reject bin. A pure reject station (R1) is its
 * own reject process; the unload station packs good pens and rejects NOK ones, so its rejects go
 * to a process of their own (e.g. "L07-UN03-EM60-REJECT") and don't look like finished output.
 */
export function rejectProcessId(cfg: LineConfig, def: StationDef): string {
  return def.kind === 'unload' ? `${processId(cfg, def)}-REJECT` : processId(cfg, def);
}

export function stationById(cfg: LineConfig, id: string): StationDef {
  return cfg.stations.find((d) => d.id === id)!;
}

/** Steps a station writes to the tag when it has done its work. */
export function stationSteps(def: StationDef): Step[] {
  if (def.step) return [def.step];
  return (def.robots ?? []).flatMap((r) => (r.step ? [r.step] : []));
}

/** Robots that place parts on the mover (not pickers), in working order. */
export function placers(def: StationDef): RobotDef[] {
  return (def.robots ?? []).filter((r) => r.source);
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
  plc.batch = { name: batchName(t), target: plc.batchSize, loaded: 0, good: 0, rejected: 0, trays: 0, traysRejected: 0, startedAt: t, state: 'running' };
  emit(s, { kind: 'batch', name: plc.batch.name, state: 'started', target: plc.batch.target, good: 0, rejected: 0, logged: t });
}
