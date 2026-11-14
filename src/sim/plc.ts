// The PLC program. Each scan it samples plant sensors, runs the machine state machine and one
// state machine per station, and writes actuators (gates, cycles, RFID, belt). It never touches
// mover positions or loads directly; it only knows what the tags and sensors tell it.
import type { LineConfig, StationDef } from './config';
import { startJob } from './devices';
import { makeIdentifier } from './gs1';
import { type Inputs, copyTag, emptyTag, readInputs } from './plant';
import type { Command } from './protocol';
import type { CycleResult, MachineState, Op, PlcState, SimEvent, SimState, Tag } from './types';

export function createPlc(cfg: LineConfig): PlcState {
  return {
    machine: 'Stopped',
    stateSince: 0,
    speedTarget: 1,
    stations: cfg.stations.map((d) => ({
      id: d.id,
      step: 'idle',
      status: 'stopped',
      timer: 0,
      tries: 0,
      moverId: null,
      tag: null,
      pendingTag: null,
      cycleStart: 0,
      reserved: false,
      op: null,
      stats: { cycles: 0, passes: 0, busy: 0, noReads: 0 },
    })),
    srCounter: 1 + cfg.stations.filter((d) => d.source === 'nest').length,
    nests: Object.fromEntries(cfg.stations.filter((d) => d.source === 'nest').map((d, i) => [d.id, { srId: 2 + i, used: 0 }])),
    tray: { srId: 1, count: 0 },
  };
}

/** Machine states in which each command is accepted. */
export const ACCEPTS: Record<Command['type'], MachineState[]> = {
  start: ['Stopped'],
  stop: ['Starting', 'Execute', 'Holding', 'Held'],
  hold: ['Starting', 'Execute'],
  unhold: ['Holding', 'Held'],
  abort: ['Stopped', 'Starting', 'Execute', 'Stopping', 'Holding', 'Held'],
  reset: ['Aborted'],
  speed: ['Stopped', 'Starting', 'Execute', 'Stopping', 'Holding', 'Held', 'Aborted'],
};

/** Applies an operator command (from any client). Returns whether the machine accepted it. */
export function applyCommand(s: SimState, cfg: LineConfig, cmd: Command, origin: string): boolean {
  const plc = s.plc;
  const accepted = ACCEPTS[cmd.type].includes(plc.machine);
  if (accepted) {
    switch (cmd.type) {
      case 'start':
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
        setMachine(s, 'Aborted');
        break;
      case 'reset':
        setMachine(s, 'Stopped');
        break;
      case 'speed':
        plc.speedTarget = Math.min(1, Math.max(cfg.speedMin, cmd.percent / 100));
        break;
    }
  }
  const label = cmd.type === 'speed' ? `speed ${cmd.percent}%` : cmd.type;
  emit(s, { kind: 'command', command: label, origin, accepted, logged: now(s) });
  return accepted;
}

function setMachine(s: SimState, state: MachineState): void {
  if (s.plc.machine === state) return;
  s.plc.machine = state;
  s.plc.stateSince = s.plant.t;
  emit(s, { kind: 'machine', state, logged: now(s) });
}

function now(s: SimState): number {
  return s.epochMs + s.plant.t * 1000;
}

function emit(s: SimState, e: SimEvent): void {
  s.mes.events.push(e);
}

export function scanPlc(s: SimState, cfg: LineConfig, dt: number): void {
  const { plant, plc } = s;
  const io = readInputs(plant, cfg);

  plant.speedTarget = plc.speedTarget;
  plant.estop = plc.machine === 'Aborted';
  // A station whose mover is only leaving has finished its work (the queue ahead may never move while stopping).
  const allIdle = plc.stations.every((st) => st.step === 'idle' || st.step === 'leaving');
  switch (plc.machine) {
    case 'Stopped':
    case 'Held':
    case 'Aborted':
      plant.beltRunning = false;
      break;
    case 'Starting':
      plant.beltRunning = true;
      if (plant.beltSpeed >= 0.95 * cfg.belt.speed * plant.speed || plant.t - plc.stateSince > 2) setMachine(s, 'Execute');
      break;
    case 'Execute':
      plant.beltRunning = true;
      break;
    case 'Stopping':
    case 'Holding':
      // Finish what's in progress, start nothing new, then stop the belt.
      plant.beltRunning = true;
      if (allIdle) setMachine(s, plc.machine === 'Stopping' ? 'Stopped' : 'Held');
      break;
  }

  if (plc.machine === 'Aborted') return;
  const canStart = plc.machine === 'Starting' || plc.machine === 'Execute';
  for (let i = 0; i < cfg.stations.length; i++) {
    scanStation(s, cfg, io, i, canStart, dt);
    // Pre-pick: a robot with a part source fetches the next part while movers index. While stopping,
    // it still fetches for a mover the station has already committed to, so the cycle can finish.
    const robot = plant.stations[i].robot;
    const def = cfg.stations[i];
    const needed = canStart || plc.stations[i].step === 'waitRobot';
    if (robot && def.source && needed && robot.job === null && !robot.holding) startJob(robot, cfg, def, 'prepick');
  }
}

function scanStation(s: SimState, cfg: LineConfig, io: Inputs, i: number, canStart: boolean, dt: number): void {
  const def = cfg.stations[i];
  const st = s.plc.stations[i];
  const ps = s.plant.stations[i];
  const r = ps.reader;

  switch (st.step) {
    case 'idle':
      st.status = canStart ? 'waiting' : 'stopped';
      if (canStart && io.inPos[i] && io.occupant[i] !== null) {
        st.moverId = io.occupant[i];
        st.tries = 0;
        st.status = 'reading';
        startRfid(s, cfg, i, 'read', null);
        st.step = 'read';
      }
      break;

    case 'read':
      if (!r.done) break;
      r.done = false;
      if (r.ok && r.data) {
        st.tag = r.data;
        decide(s, cfg, i);
      } else if (++st.tries < cfg.rfid.maxTries) {
        st.timer = cfg.rfid.retryDelay;
        st.step = 'retryRead';
      } else {
        // No read: the mover goes on untouched; downstream stations will see the missing step.
        st.stats.noReads++;
        st.reserved = false;
        emit(s, { kind: 'station', process: devId(cfg, def), message: 'RFID no read', carrier: carrierId(st.moverId!), logged: now(s) });
        release(s, i, true);
      }
      break;

    case 'retryRead':
      st.timer -= dt;
      if (st.timer <= 0) {
        startRfid(s, cfg, i, 'read', null);
        st.step = 'read';
      }
      break;

    case 'waitRobot': {
      // The mover is in position; start the robot as soon as it's ready (holding a part, or free).
      st.stats.busy += dt;
      const robot = ps.robot!;
      if (def.source) {
        if (robot.job === null && robot.holding) {
          startJob(robot, cfg, def, 'place', { op: st.op!, moverId: st.moverId! });
          st.step = 'working';
          st.status = 'working';
        } else {
          st.status = robot.phase === 'starved' ? 'starved' : 'working';
        }
      } else if (robot.job === null && !robot.holding) {
        startJob(robot, cfg, def, 'pickMover', { moverId: st.moverId! });
        st.step = 'working';
        st.status = 'working';
      } else {
        st.status = robot.phase === 'blocked' ? 'blocked' : 'working';
      }
      break;
    }

    case 'working': {
      st.stats.busy += dt;
      const robot = ps.robot;
      if (robot) {
        if (robot.job !== null) break;
        st.stats.cycles++;
        finish(s, cfg, i, robot.result ?? { measurement: null });
        const op = st.op!;
        if (op.kind === 'reject' || op.kind === 'unload') {
          const toTray = op.kind === 'unload' && op.good;
          startJob(robot, cfg, def, 'drop', { dropTarget: toTray ? { kind: 'tray' } : { kind: 'bin', bin: op.bin } });
        }
      } else {
        if (!ps.cycleDone) break;
        ps.cycleDone = false;
        st.stats.cycles++;
        finish(s, cfg, i, ps.result ?? { measurement: null });
      }
      st.tries = 0;
      startRfid(s, cfg, i, 'write', st.pendingTag);
      st.step = 'write';
      break;
    }

    case 'write':
      if (!r.done) break;
      r.done = false;
      if (r.ok) {
        release(s, i, false);
      } else if (++st.tries < cfg.rfid.maxTries) {
        st.timer = cfg.rfid.retryDelay;
        st.step = 'retryWrite';
      } else {
        // Tag couldn't be updated; the item stays physically changed but the tag is stale.
        emit(s, { kind: 'station', process: devId(cfg, def), message: 'RFID write failed', carrier: carrierId(st.moverId!), logged: now(s) });
        release(s, i, false);
      }
      break;

    case 'retryWrite':
      st.timer -= dt;
      if (st.timer <= 0) {
        startRfid(s, cfg, i, 'write', st.pendingTag);
        st.step = 'write';
      }
      break;

    case 'leaving':
      if (io.occupant[i] !== st.moverId) {
        ps.gateClosed = true;
        st.step = 'idle';
        st.moverId = null;
        st.tag = null;
        st.pendingTag = null;
      }
      break;
  }
}

function startRfid(s: SimState, cfg: LineConfig, i: number, kind: 'read' | 'write', write: Tag | null): void {
  const r = s.plant.stations[i].reader;
  const st = s.plc.stations[i];
  r.busy = true;
  r.done = false;
  r.kind = kind;
  r.moverId = st.moverId!;
  r.left = kind === 'read' ? cfg.rfid.readTime : cfg.rfid.writeTime;
  r.write = write ? copyTag(write) : null;
  r.data = null;
}

function release(s: SimState, i: number, passing: boolean): void {
  const st = s.plc.stations[i];
  if (passing) {
    st.stats.passes++;
    st.status = 'passing';
  }
  s.plant.stations[i].gateClosed = false;
  st.step = 'leaving';
}

/**
 * A twin partner can take a mover that needs work if it isn't working and hasn't already been
 * promised one. Movers already processed upstream only pass through it, so they don't block.
 */
function partnerFree(s: SimState, cfg: LineConfig, partnerId: string): number | null {
  const pi = cfg.stations.findIndex((d) => d.id === partnerId);
  const p = s.plc.stations[pi];
  return p.step !== 'working' && p.step !== 'waitRobot' && !p.reserved ? pi : null;
}

function decide(s: SimState, cfg: LineConfig, i: number): void {
  const def = cfg.stations[i];
  const st = s.plc.stations[i];
  const tag = st.tag!;
  const pass = () => release(s, i, true);

  switch (def.kind) {
    case 'load': {
      if (tag.status !== 'empty') return pass();
      const srId = ++s.plc.srCounter;
      const mark = makeIdentifier(s.rng, cfg.gs1.gtin, now(s), cfg.gs1.expiryYears);
      s.mes.identifiers[srId] = mark;
      return start(s, cfg, i, { kind: 'load', srId, mark });
    }
    case 'assemble':
    case 'inspect': {
      if (tag.status !== 'ok' || (def.step && tag.done.includes(def.step))) return pass();
      const missing = (def.requires ?? []).filter((r) => !tag.done.includes(r));
      if (missing.length > 0) {
        // Flag it NOK so a reject station takes it out.
        st.pendingTag = { ...copyTag(tag), status: 'nok', reason: `Missing step: ${missing.join(', ')}` };
        st.tries = 0;
        st.status = 'passing';
        st.stats.passes++;
        startRfid(s, cfg, i, 'write', st.pendingTag);
        st.step = 'write';
        return;
      }
      if (def.twin) {
        const pi = partnerFree(s, cfg, def.twin);
        if (pi !== null) {
          s.plc.stations[pi].reserved = true;
          return pass();
        }
      }
      if (def.kind === 'inspect') {
        return start(s, cfg, i, { kind: 'inspect', measure: def.inspect!.key, noise: def.inspect!.noise, readCode: !!def.readsCode });
      }
      return start(s, cfg, i, { kind: 'assemble', parts: def.parts ?? [], fragile: !!def.fragile, measure: def.inspect?.key ?? null });
    }
    case 'reject':
      return tag.status === 'nok' ? start(s, cfg, i, { kind: 'reject', bin: def.bin! }) : pass();
    case 'unload': {
      if (tag.status === 'empty') return pass();
      const good = tag.status === 'ok' && tag.done.includes('final');
      return start(s, cfg, i, { kind: 'unload', good, bin: def.bin! });
    }
  }
}

/** Starts work on the mover: robot stations hand over to the robot, inspections trigger the camera. */
function start(s: SimState, cfg: LineConfig, i: number, op: Op): void {
  const ps = s.plant.stations[i];
  const def = cfg.stations[i];
  const st = s.plc.stations[i];
  st.reserved = false;
  st.cycleStart = s.plant.t;
  st.status = 'working';
  st.op = op;
  if (ps.robot) {
    st.step = 'waitRobot';
  } else {
    ps.cycle = { op, moverId: st.moverId!, mechLeft: def.mech, fixedLeft: def.fixed };
    ps.cycleDone = false;
    st.step = 'working';
  }
}

function devId(cfg: LineConfig, def: StationDef): string {
  return `${cfg.id}-${def.id}`;
}

function carrierId(moverId: number): string {
  return String(moverId).padStart(2, '0');
}

function evaluate(def: StationDef, value: number | null): { passed: boolean; cause: string | null; props: Record<string, number | string | boolean> } {
  const lim = def.inspect!;
  const passed = value !== null && value >= lim.lower && value <= lim.upper;
  const props: Record<string, number | string | boolean> = {
    'Inspection Value': value ?? Number.NaN,
    'Inspection Lower Limit': lim.lower,
    'Inspection Upper Limit': lim.upper,
    'Inspection Passed': passed,
  };
  let cause: string | null = null;
  if (!passed) {
    cause = value === null ? 'No measurement' : value > lim.upper ? `${lim.cause} (high)` : `${lim.cause} (low)`;
    props['Reject Cause'] = cause;
  }
  return { passed, cause, props };
}

function finish(s: SimState, cfg: LineConfig, i: number, result: CycleResult): void {
  const def = cfg.stations[i];
  const st = s.plc.stations[i];
  const op = st.op!;
  const tag = copyTag(st.tag!);
  const process = devId(cfg, def);
  const carrier = carrierId(st.moverId!);
  const from = s.epochMs + st.cycleStart * 1000;
  const to = now(s);
  const mes = s.mes;

  switch (op.kind) {
    case 'load': {
      st.pendingTag = { srId: op.srId, status: 'ok', done: ['body'], reason: null };
      emit(s, { kind: 'processed', process, scopedId: op.srId, itemType: 'Pen', from, to, carrier, identifier: op.mark, properties: { 'Mover Id': carrier } });
      return;
    }
    case 'assemble': {
      const pen = tag.srId!;
      for (const part of op.parts) {
        const partId = ++s.plc.srCounter;
        const partType = part[0].toUpperCase() + part.slice(1);
        if (part === 'cartridge') {
          const nest = s.plc.nests[def.id];
          if (nest.used >= cfg.nestSize) {
            nest.srId = ++s.plc.srCounter;
            nest.used = 0;
          }
          emit(s, { kind: 'processed', process, scopedId: partId, itemType: partType, from, to, sourceScopedId: nest.srId, sourcePosition: nest.used++ });
        }
        emit(s, { kind: 'merged', process, target: pen, source: partId, sourceType: partType, position: 0, logged: from });
      }
      tag.done.push(def.step!);
      let props: Record<string, number | string | boolean> = { 'Mover Id': carrier };
      let resultFlag: 'Passed' | 'Failed' | undefined;
      if (def.inspect) {
        const ev = evaluate(def, result.measurement);
        props = { ...props, ...ev.props };
        resultFlag = ev.passed ? 'Passed' : 'Failed';
        if (!ev.passed) {
          tag.status = 'nok';
          tag.reason = ev.cause;
        }
      }
      st.pendingTag = tag;
      emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, result: resultFlag, properties: props });
      return;
    }
    case 'inspect': {
      const pen = tag.srId!;
      const ev = evaluate(def, result.measurement);
      let passed = ev.passed;
      let cause = ev.cause;
      const props: Record<string, number | string | boolean> = { 'Mover Id': carrier, ...ev.props };
      if (op.readCode) {
        const expected = mes.identifiers[pen];
        const codeOk = result.code === expected;
        props['Code Read'] = result.code ?? '';
        if (!codeOk && passed) {
          passed = false;
          cause = result.code === null ? 'DataMatrix no read' : 'ID mismatch';
          props['Inspection Passed'] = false;
          props['Reject Cause'] = cause;
        }
      }
      tag.done.push(def.step!);
      if (!passed) {
        tag.status = 'nok';
        tag.reason = cause;
      }
      st.pendingTag = tag;
      emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, result: passed ? 'Passed' : 'Failed', properties: props });
      return;
    }
    case 'reject':
    case 'unload': {
      const pen = tag.srId;
      const good = op.kind === 'unload' && op.good;
      st.pendingTag = emptyTag();
      if (pen === null) return;
      const stats = (mes.movers[st.moverId!] ??= { pens: 0, rejects: 0 });
      if (good) {
        const tray = s.plc.tray;
        emit(s, { kind: 'merged', process, target: tray.srId, source: pen, sourceType: 'Pen', position: tray.count, logged: from });
        emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, properties: { 'Mover Id': carrier, 'Tray Position': tray.count } });
        tray.count++;
        mes.good++;
        stats.pens++;
        if (tray.count >= cfg.traySize) {
          emit(s, { kind: 'processed', process, scopedId: tray.srId, itemType: 'Tray', from, to, properties: { Count: tray.count } });
          tray.srId = ++s.plc.srCounter;
          tray.count = 0;
        }
      } else {
        const cause = tag.reason ?? 'Incomplete';
        const bin = op.kind === 'reject' || op.kind === 'unload' ? op.bin : '';
        emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, properties: { 'Mover Id': carrier, 'Reject Cause': cause, Bin: bin } });
        mes.rejected++;
        mes.rejectsByCause[cause] = (mes.rejectsByCause[cause] ?? 0) + 1;
        stats.rejects++;
      }
      delete mes.identifiers[pen];
      return;
    }
  }
}
