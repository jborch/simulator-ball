// Operator commands. Any client may send them; only the host applies them, after checking
// them against the machine state, and every command is logged with its origin.
import type { LineConfig } from './config';
import { raise } from './alarms';
import { repairTime } from './devices';
import { emit, now, setMachine, startBatch } from './machine';
import type { Command } from './protocol';
import type { MachineState, SimState } from './types';

const ALL: MachineState[] = ['Stopped', 'Starting', 'Execute', 'Completing', 'Complete', 'Stopping', 'Holding', 'Held', 'Aborted'];

/** Machine states in which each command is accepted. */
export const ACCEPTS: Record<Command['type'], MachineState[]> = {
  start: ['Stopped', 'Complete'],
  stop: ['Starting', 'Execute', 'Completing', 'Holding', 'Held'],
  hold: ['Starting', 'Execute', 'Completing'],
  unhold: ['Holding', 'Held'],
  abort: ALL.filter((m) => m !== 'Aborted'),
  reset: ['Aborted', 'Complete'],
  speed: ALL,
  endBatch: ['Stopped', 'Starting', 'Execute', 'Holding', 'Held'],
  batchSize: ALL,
  autoBatch: ALL,
  fault: ALL.filter((m) => m !== 'Aborted'),
};

function label(cmd: Command): string {
  switch (cmd.type) {
    case 'speed':
      return `speed ${cmd.percent}%`;
    case 'batchSize':
      return `batch size ${cmd.size}`;
    case 'autoBatch':
      return `auto next batch ${cmd.on ? 'on' : 'off'}`;
    case 'fault':
      return `inject fault on ${cmd.target}`;
    case 'endBatch':
      return 'end batch';
    default:
      return cmd.type;
  }
}

/** Applies an operator command. Returns whether the machine accepted it. */
export function applyCommand(s: SimState, cfg: LineConfig, cmd: Command, origin: string): boolean {
  const plc = s.plc;
  let accepted = ACCEPTS[cmd.type].includes(plc.machine);
  if (accepted) {
    switch (cmd.type) {
      case 'start':
        if (!plc.batch || plc.batch.state === 'complete') startBatch(s);
        plc.interrupted = false;
        setMachine(s, 'Starting');
        break;
      case 'unhold':
        setMachine(s, 'Starting');
        break;
      case 'stop':
        setMachine(s, plc.machine === 'Held' ? 'Stopped' : 'Stopping');
        break;
      case 'hold':
        setMachine(s, 'Holding');
        break;
      case 'abort':
        plc.interrupted = true;
        setMachine(s, 'Aborted');
        break;
      case 'reset':
        setMachine(s, 'Stopped');
        break;
      case 'speed':
        plc.speedTarget = Math.min(1, Math.max(cfg.speedMin, cmd.percent / 100));
        break;
      case 'endBatch':
        accepted = plc.batch?.state === 'running';
        if (accepted) {
          plc.batch!.state = 'completing';
          plc.batch!.ended = true;
        }
        break;
      case 'batchSize':
        plc.batchSize = Math.max(1, Math.round(cmd.size));
        break;
      case 'autoBatch':
        plc.autoNext = cmd.on;
        break;
      case 'fault':
        accepted = injectFault(s, cfg, cmd.target);
        break;
    }
  }
  emit(s, { kind: 'command', command: label(cmd), origin, accepted, logged: now(s) });
  return accepted;
}

/** Sub-line faults that can be injected, by target id. */
export const SUBLINE_FAULTS: Record<string, string> = {
  'EM13-ORIENTER': 'EM13 orienter: fault',
  'EM30-DIAL': 'Housing dial: jam',
  'EM31-ROLL': 'EM31 label roll: empty',
  'EM00-PICK': 'EM00: drop the next cartridge',
  'EM60-DESTACKER': 'Tray destacker: empty',
};

/** Robots whose stroke can overload (EM14 presses): injected as "<robot>-OVERLOAD". */
export function overloadTargets(cfg: LineConfig): string[] {
  return cfg.stations.flatMap((d) => (d.robots ?? []).filter((r) => r.step === 'springBase').map((r) => `${r.id}-OVERLOAD`));
}

/** Makes a robot, feeder or sub-line fail now, as if it had happened on the real line. */
function injectFault(s: SimState, cfg: LineConfig, target: string): boolean {
  const p = s.plant;
  switch (target) {
    case 'EM13-ORIENTER':
      raise(p, cfg, s.rng, 'orienter');
      return true;
    case 'EM30-DIAL':
      raise(p, cfg, s.rng, 'dialJam');
      return true;
    case 'EM31-ROLL':
      p.dial.roll = 0;
      raise(p, cfg, s.rng, 'labelRoll');
      return true;
    case 'EM00-PICK':
      p.cartridges.missNext = true;
      return true;
    case 'EM60-DESTACKER':
      p.tray.stack = 0;
      raise(p, cfg, s.rng, 'destacker');
      return true;
  }
  if (overloadTargets(cfg).includes(target)) {
    const id = target.replace(/-OVERLOAD$/, '');
    const i = cfg.stations.findIndex((d) => d.robots?.some((r) => r.id === id));
    const robot = p.stations[i].robots[cfg.stations[i].robots!.findIndex((r) => r.id === id)];
    // One fault at a time: a robot already stopped can't be made to stop for another reason too.
    if (robot.fault > 0) return false;
    robot.fault = repairTime(s.rng, cfg.faults.overloadRepair);
    robot.faultKind = 'overload';
    return true;
  }
  const fi = cfg.feeders.findIndex((f) => f.id === target);
  if (fi >= 0) {
    s.plant.feeders[fi].jam = repairTime(s.rng, cfg.faults.feederRepair);
    return true;
  }
  const i = cfg.stations.findIndex((d) => d.robots?.some((r) => r.id === target));
  if (i < 0) return false;
  const robot = s.plant.stations[i].robots[cfg.stations[i].robots!.findIndex((r) => r.id === target)];
  if (robot.fault > 0) return false;
  robot.fault = repairTime(s.rng, cfg.faults.robotRepair);
  return true;
}
