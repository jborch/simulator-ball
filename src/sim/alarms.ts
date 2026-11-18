// Sub-line alarms: equipment off the mover loop that stops until the operator has seen to it
// (the housing dial jams, EM31's label roll runs out, the EM13 orienter faults, the tray destacker
// runs empty). The plant raises an alarm with the time the operator will take; the equipment holds
// still while it is up. The PLC reports each alarm as a station event when it comes and goes.
import type { LineConfig } from './config';
import { repairTime } from './devices';
import { emit, now, subProcessId, trayProcessId } from './machine';
import type { RngState } from './rng';
import type { AlarmId, PlantState, SimState, StationCode } from './types';

export function createAlarms(): Record<AlarmId, number> {
  return { dialJam: 0, labelRoll: 0, orienter: 0, destacker: 0 };
}

/** Repair (or refill) time of each alarm. */
function repairOf(cfg: LineConfig, id: AlarmId): [number, number] {
  const f = cfg.faults;
  return { dialJam: f.dialRepair, labelRoll: f.rollChange, orienter: f.orienterRepair, destacker: f.stackRefill }[id];
}

/** Raises an alarm (if it isn't up already) for as long as the operator takes. */
export function raise(p: PlantState, cfg: LineConfig, rng: RngState, id: AlarmId): void {
  if (p.alarms[id] > 0) return;
  p.alarms[id] = repairTime(rng, repairOf(cfg, id));
}

/** The operator at work: alarms count down, and a changed roll or refilled stack is full again. */
export function stepAlarms(p: PlantState, cfg: LineConfig, dt: number): void {
  for (const id of Object.keys(p.alarms) as AlarmId[]) {
    if (p.alarms[id] <= 0) continue;
    p.alarms[id] = Math.max(0, p.alarms[id] - dt);
    if (p.alarms[id] > 0) continue;
    if (id === 'labelRoll') p.dial.roll = cfg.faults.labelRoll;
    if (id === 'destacker') p.tray.stack = cfg.faults.trayStack;
  }
}

/** Where each alarm is reported, and what it says when it comes and goes. */
const REPORT: Record<AlarmId, { device: (cfg: LineConfig) => string; on: [StationCode, string]; off: [StationCode, string] }> = {
  dialJam: { device: (c) => subProcessId(c, c.dial.load), on: ['dialJam', 'Dial jam: operator called'], off: ['dialJamCleared', 'Dial jam cleared'] },
  labelRoll: { device: (c) => subProcessId(c, c.dial.label), on: ['labelRollEmpty', 'Label roll empty: operator changing it'], off: ['labelRollChanged', 'Label roll changed'] },
  orienter: { device: (c) => subProcessId(c, c.orienter), on: ['orienterFault', 'Orienter fault: operator called'], off: ['orienterFaultCleared', 'Orienter fault cleared'] },
  destacker: { device: (c) => trayProcessId(c), on: ['destackerEmpty', 'Tray destacker empty: operator refilling it'], off: ['destackerRefilled', 'Tray destacker refilled'] },
};

/** PLC: reports alarms coming and going, and each cartridge EM00 drops. */
export function scanAlarms(s: SimState, cfg: LineConfig): void {
  const { plant, plc } = s;
  for (const id of Object.keys(plant.alarms) as AlarmId[]) {
    const up = plant.alarms[id] > 0;
    if (up === !!plc.alarms[id]) continue;
    plc.alarms[id] = up;
    const r = REPORT[id];
    const [code, message] = up ? r.on : r.off;
    emit(s, { kind: 'station', process: r.device(cfg), code, message, logged: now(s) });
  }
  const misses = plant.cartridges.misses;
  for (; plc.misses < misses; plc.misses++) {
    emit(s, { kind: 'station', process: subProcessId(cfg, cfg.cartridges.denest), code: 'pickMiss', message: 'Cartridge dropped at pick (scrapped)', logged: now(s) });
  }
}
