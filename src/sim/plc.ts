// The PLC program. Each scan it samples plant sensors, runs the machine state machine and one
// state machine per station, and writes actuators (gates, robot jobs, camera, RFID, belt). It
// never touches mover positions or loads directly; it only knows what tags and sensors tell it.
import type { LineConfig } from './config';
import { makeIdentifier } from './gs1';
import { carrierId, emit, now, processId, setMachine, startBatch } from './machine';
import { type Inputs, readInputs } from './plant';
import { recordCycle } from './records';
import { startJob } from './robot';
import { copyTag } from './tags';
import type { Op, PlaceOp, PlcState, SimState, Tag } from './types';

export function createPlc(cfg: LineConfig): PlcState {
  const nestStations = cfg.stations.filter((d) => d.source === 'nest');
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
      stats: { cycles: 0, passes: 0, busy: 0, noReads: 0, faults: 0, faultTime: 0 },
      faulted: false,
    })),
    // SR ids 1.. are taken by the first tray and the first nest of each nest-fed station.
    srCounter: 1 + nestStations.length,
    tray: { srId: 1, count: 0 },
    nests: Object.fromEntries(nestStations.map((d, i) => [d.id, { srId: 2 + i, used: 0 }])),
    batch: null,
    batchSize: cfg.batch.size,
    autoNext: cfg.batch.autoNext,
    jammed: {},
  };
}

export function scanPlc(s: SimState, cfg: LineConfig, dt: number): void {
  const { plant, plc } = s;
  const io = readInputs(plant, cfg);

  plant.speedTarget = plc.speedTarget;
  plant.estop = plc.machine === 'Aborted';
  scanMachine(s, cfg);
  scanFaults(s, cfg, dt);
  if (plc.machine === 'Aborted') return;

  const canStart = plc.machine === 'Starting' || plc.machine === 'Execute' || plc.machine === 'Completing';
  cfg.stations.forEach((def, i) => {
    scanStation(s, cfg, io, i, canStart, dt);
    const robot = plant.stations[i].robot;
    if (!robot) return;
    if (robot.fault > 0) plc.stations[i].status = 'fault';
    // Pre-pick: a robot with a part source fetches the next part while movers index. While
    // stopping it still fetches for a mover the station has already committed to.
    const needed = canStart || plc.stations[i].step === 'waitRobot';
    if (def.source && needed && robot.job === null && !robot.holding) startJob(robot, def, 'prepick');
  });
}

/** Machine (PackML-style) state machine: belt drive, batch run-out and auto-next. */
function scanMachine(s: SimState, cfg: LineConfig): void {
  const { plant, plc } = s;
  const batch = plc.batch;
  // A station whose mover is only leaving has finished its work (the queue ahead may never move while stopping).
  const allIdle = plc.stations.every((st) => st.step === 'idle' || st.step === 'leaving');
  plant.beltRunning = !['Stopped', 'Held', 'Aborted', 'Complete'].includes(plc.machine);

  switch (plc.machine) {
    case 'Starting':
      if (plant.beltSpeed >= 0.95 * cfg.belt.speed * plant.speed || plant.t - plc.stateSince > 2) {
        setMachine(s, batch?.state === 'completing' ? 'Completing' : 'Execute');
      }
      break;
    case 'Execute':
      if (batch && (batch.state === 'completing' || batch.loaded >= batch.target)) {
        batch.state = 'completing';
        setMachine(s, 'Completing');
      }
      break;
    case 'Completing': {
      // Run-out: ST10 has stopped loading; finish every pen still on the line.
      const inFlight = batch ? batch.loaded - batch.good - batch.rejected : 0;
      if (inFlight <= 0 && allIdle) {
        if (batch) {
          batch.state = 'complete';
          emit(s, { kind: 'batch', name: batch.name, state: 'completed', target: batch.target, good: batch.good, rejected: batch.rejected, logged: now(s) });
        }
        setMachine(s, 'Complete');
      }
      break;
    }
    case 'Complete':
      if (plc.autoNext && plant.t - plc.stateSince >= cfg.batch.pause) {
        startBatch(s);
        setMachine(s, 'Starting');
      }
      break;
    case 'Stopping':
    case 'Holding':
      // Finish what's in progress, start nothing new, then stop the belt.
      if (allIdle) setMachine(s, plc.machine === 'Stopping' ? 'Stopped' : 'Held');
      break;
  }
}

/** Reports fault inputs (robot axis faults, feeder jams) as events when they change. */
function scanFaults(s: SimState, cfg: LineConfig, dt: number): void {
  const { plant, plc } = s;
  cfg.stations.forEach((def, i) => {
    const st = plc.stations[i];
    const faulted = (plant.stations[i].robot?.fault ?? 0) > 0;
    if (faulted) st.stats.faultTime += dt;
    if (faulted === st.faulted) return;
    st.faulted = faulted;
    if (faulted) st.stats.faults++;
    emit(s, { kind: 'station', process: processId(cfg, def), message: faulted ? 'Axis fault: operator called' : 'Axis fault cleared', logged: now(s) });
  });
  cfg.feeders.forEach((f, i) => {
    const jammed = plant.feeders[i].jam > 0;
    if (jammed === !!plc.jammed[f.id]) return;
    plc.jammed[f.id] = jammed;
    const station = cfg.stations.find((d) => d.source === f.id);
    const process = station ? processId(cfg, station) : `${cfg.id}-${f.id}`;
    emit(s, { kind: 'station', process, message: jammed ? `Feeder jam (${f.id}): operator called` : `Feeder jam cleared (${f.id})`, logged: now(s) });
  });
}

/**
 * Station state machine: wait for a settled mover, read its tag, decide (work / pass), run the
 * robot or camera, write the tag back, open the gate and close it behind the mover.
 */
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
        emit(s, { kind: 'station', process: processId(cfg, def), message: 'RFID no read', carrier: carrierId(st.moverId!), logged: now(s) });
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
      // The mover is in position; start the robot as soon as it's ready: holding a part to place,
      // or empty-handed to pick the pen off the mover.
      st.stats.busy += dt;
      const robot = ps.robot!;
      const ready = robot.job === null && (def.source ? !!robot.holding : !robot.holding);
      if (ready) {
        if (def.source) startJob(robot, def, 'place', { op: st.op as PlaceOp, moverId: st.moverId! });
        else startJob(robot, def, 'pickMover', { moverId: st.moverId! });
        st.step = 'working';
        st.status = 'working';
      } else {
        st.status = robot.phase === 'starved' ? 'starved' : robot.phase === 'blocked' ? 'blocked' : 'working';
      }
      break;
    }

    case 'working': {
      st.stats.busy += dt;
      let result;
      if (ps.robot) {
        if (ps.robot.job !== null) break;
        result = ps.robot.result;
      } else {
        const cam = ps.camera!;
        if (!cam.done) break;
        cam.done = false;
        result = cam.result;
      }
      st.stats.cycles++;
      const op = st.op!;
      const tag = recordCycle(s, cfg, i, result ?? { measurement: null });
      if (ps.robot && (op.kind === 'reject' || op.kind === 'unload')) {
        // The pen is in the gripper; drop it while the mover moves on.
        const toTray = op.kind === 'unload' && op.good;
        startJob(ps.robot, def, 'drop', { dropTarget: toTray ? { kind: 'tray' } : { kind: 'bin', bin: op.bin } });
      }
      writeTag(s, cfg, i, tag);
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
        // The item is physically changed but its tag is stale.
        emit(s, { kind: 'station', process: processId(cfg, def), message: 'RFID write failed', carrier: carrierId(st.moverId!), logged: now(s) });
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
  r.busy = true;
  r.done = false;
  r.kind = kind;
  r.moverId = s.plc.stations[i].moverId!;
  r.left = kind === 'read' ? cfg.rfid.readTime : cfg.rfid.writeTime;
  r.write = write ? copyTag(write) : null;
  r.data = null;
}

function writeTag(s: SimState, cfg: LineConfig, i: number, tag: Tag): void {
  const st = s.plc.stations[i];
  st.pendingTag = tag;
  st.tries = 0;
  startRfid(s, cfg, i, 'write', tag);
  st.step = 'write';
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

/** Decides what to do with the mover whose tag was just read. */
function decide(s: SimState, cfg: LineConfig, i: number): void {
  const def = cfg.stations[i];
  const st = s.plc.stations[i];
  const tag = st.tag!;
  const pass = () => release(s, i, true);

  switch (def.kind) {
    case 'load': {
      const b = s.plc.batch;
      if (tag.status !== 'empty' || !b || b.state !== 'running' || b.loaded >= b.target) return pass();
      b.loaded++;
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
        // An upstream step was skipped (e.g. RFID no read): flag NOK so a reject station takes it out.
        st.status = 'passing';
        st.stats.passes++;
        return writeTag(s, cfg, i, { ...copyTag(tag), status: 'nok', reason: `Missing step: ${missing.join(', ')}` });
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
  if (op.kind === 'inspect') {
    ps.camera!.cycle = { op, moverId: st.moverId!, mechLeft: def.mech, fixedLeft: def.fixed };
    ps.camera!.done = false;
    st.step = 'working';
  } else {
    st.step = 'waitRobot';
  }
}
