// The PLC program. Each scan it samples plant sensors, runs the machine state machine and one
// state machine per station, and writes actuators (gates, robot jobs, camera, RFID, belt). It
// never touches mover positions or loads directly; it only knows what tags and sensors tell it.
import type { LineConfig, RobotDef, StationDef } from './config';
import { makeIdentifier } from './gs1';
import { carrierId, emit, feederId, now, placers, processId, setMachine, stationSteps, startBatch } from './machine';
import { type Inputs, readInputs } from './plant';
import { closeTray, recordCycle, recordOutput } from './records';
import { leftMover, startJob } from './robot';
import { copyTag } from './tags';
import type { Op, PlaceOp, PlcState, Robot, SimState, Tag } from './types';

export function createPlc(cfg: LineConfig): PlcState {
  const nestStations = cfg.stations.filter((d) => d.robots?.some((r) => r.source === 'nest'));
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
      reserved: null,
      op: null,
      job: 0,
      result: null,
      stats: { cycles: 0, passes: 0, busy: 0, noReads: 0, faults: 0, faultTime: 0 },
      faulted: {},
      output: null,
    })),
    // SR ids 1.. are taken by the first tray and the first nest of each nest-fed station.
    srCounter: 1 + nestStations.length,
    tray: { srId: 1, count: 0, start: 0 },
    nests: Object.fromEntries(nestStations.map((d, i) => [d.id, { srId: 2 + i, used: 0 }])),
    batch: null,
    interrupted: false,
    batchSize: cfg.batch.size,
    autoNext: cfg.batch.autoNext,
    jammed: {},
  };
}

export function scanPlc(s: SimState, cfg: LineConfig, dt: number): void {
  const { plant, plc } = s;
  const io = readInputs(plant, cfg);

  plant.speedTarget = plc.speedTarget;
  // After an E-stop the equipment stays frozen, through Reset, until the operator presses Start.
  plant.estop = plc.machine === 'Aborted' || plc.interrupted;
  scanMachine(s, cfg);
  scanFaults(s, cfg, dt);
  if (plant.estop) return;

  const canStart = plc.machine === 'Starting' || plc.machine === 'Execute' || plc.machine === 'Completing';
  cfg.stations.forEach((def, i) => {
    const robots = plant.stations[i].robots;
    // A picked pen counts as output once the robot has let go of it over the tray or bin.
    if (robots[0]?.dropped) {
      robots[0].dropped = false;
      if (plc.stations[i].output) recordOutput(s, cfg, i);
    }
    scanStation(s, cfg, io, i, canStart, dt);
    if (robots.some((r) => r.fault > 0)) plc.stations[i].status = 'fault';
    // Pre-pick: a robot with a part source fetches the next part while movers index, as long as
    // more parts will be needed. While stopping it only fetches for a mover it's committed to.
    const running = plc.machine === 'Starting' || plc.machine === 'Execute' || (plc.machine === 'Completing' && def.kind !== 'load');
    const st = plc.stations[i];
    const inCycle = (st.step === 'waitRobot' || st.step === 'working') && st.op?.kind === 'place';
    robots.forEach((robot, k) => {
      const rdef = def.robots![k];
      if (!rdef.source) return;
      // Beyond that, only a robot whose turn on the current mover is still to come.
      const needed = running || (inCycle && placers(def).indexOf(rdef) >= st.job);
      if (needed && robot.job === null && !robot.holding) startJob(robot, rdef, 'prepick');
      else if (!needed && waitingForPart(robot)) cancelJob(robot);
    });
  });
}

/** A pre-pick still waiting at an empty source hasn't touched anything yet and may be called off. */
function waitingForPart(robot: Robot): boolean {
  return robot.job === 'prepick' && robot.steps[0]?.k === 'waitSource';
}

function cancelJob(robot: Robot): void {
  robot.job = null;
  robot.steps = [];
  robot.phase = 'idle';
}

/** Machine (PackML-style) state machine: belt drive, batch run-out and auto-next. */
function scanMachine(s: SimState, cfg: LineConfig): void {
  const { plant, plc } = s;
  const batch = plc.batch;
  // A station whose mover is only leaving has finished its work (the queue ahead may never move
  // while stopping). Robots, nest and tray changes must have finished too, so nothing moves once
  // stopped.
  const allIdle =
    plc.stations.every((st) => st.step === 'idle' || st.step === 'leaving') &&
    plant.stations.every((ps) => ps.robots.every((r) => r.job === null || waitingForPart(r))) &&
    plant.tray.changing === 0 &&
    plant.nests.every((n) => n.changing === 0);
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
      // Run-out: the load station has stopped loading; finish every pen still on the line.
      const inFlight = batch ? batch.loaded - batch.good - batch.rejected : 0;
      if (inFlight > 0 || !allIdle) break;
      // The batch's last tray goes out even if it isn't full, so batches never share a tray.
      if (plc.tray.count > 0) {
        closeTray(s, cfg);
        plant.tray.discharge = true;
      }
      if (!plant.tray.discharge && plant.tray.changing === 0) {
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
    const robots = plant.stations[i].robots;
    if (robots.some((r) => r.fault > 0)) st.stats.faultTime += dt;
    robots.forEach((robot, k) => {
      const id = def.robots![k].id;
      const faulted = robot.fault > 0;
      if (faulted === !!st.faulted[id]) return;
      st.faulted[id] = faulted;
      if (faulted) st.stats.faults++;
      // Single-robot stations share their id with the robot, so only name the robot where it helps.
      const which = id === def.id ? '' : ` (${id})`;
      emit(s, { kind: 'station', process: processId(cfg, def), code: faulted ? 'axisFault' : 'axisFaultCleared', message: faulted ? `Axis fault${which}: operator called` : `Axis fault cleared${which}`, logged: now(s) });
    });
  });
  cfg.feeders.forEach((f, i) => {
    const jammed = plant.feeders[i].jam > 0;
    if (jammed === !!plc.jammed[f.id]) return;
    plc.jammed[f.id] = jammed;
    emit(s, { kind: 'station', process: feederId(cfg, f.id), code: jammed ? 'feederJam' : 'feederJamCleared', message: jammed ? `Feeder jam (${f.id}): operator called` : `Feeder jam cleared (${f.id})`, logged: now(s) });
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
        if (st.reserved === st.moverId) st.reserved = null;
        emit(s, { kind: 'station', process: processId(cfg, def), code: 'rfidNoRead', message: 'RFID no read', carrier: carrierId(st.moverId!), logged: now(s) });
        release(s, i, true);
      }
      break;

    case 'waitGroup':
      // Holding the mover until the group's members downstream are done (see decide).
      st.status = 'waiting';
      decide(s, cfg, i);
      break;

    case 'retryRead':
      st.timer -= dt;
      if (st.timer <= 0) {
        startRfid(s, cfg, i, 'read', null);
        st.step = 'read';
      }
      break;

    case 'waitRobot': {
      // The mover is in position; start the robot whose turn it is as soon as it's ready: holding
      // a part to place, or empty-handed to pick the pen off the mover.
      st.stats.busy += dt;
      const op = st.op!;
      const rdef = op.kind === 'place' ? placers(def)[st.job] : def.robots![0];
      const robot = ps.robots[def.robots!.indexOf(rdef)];
      const ready = robot.job === null && (rdef.source ? !!robot.holding : !robot.holding);
      if (ready) {
        if (op.kind === 'place') startJob(robot, rdef, 'place', { op: op.places[st.job], moverId: st.moverId! });
        else startJob(robot, rdef, 'pickMover', { moverId: st.moverId! });
        st.step = 'working';
        st.status = 'working';
      } else {
        st.status = robot.phase === 'starved' ? 'starved' : robot.phase === 'blocked' ? 'blocked' : 'working';
      }
      break;
    }

    case 'working': {
      st.stats.busy += dt;
      const op = st.op!;
      if (ps.camera) {
        const cam = ps.camera;
        if (!cam.done) break;
        cam.done = false;
        st.result = cam.result;
      } else {
        const rdef = op.kind === 'place' ? placers(def)[st.job] : def.robots![0];
        const robot = ps.robots[def.robots!.indexOf(rdef)];
        if (op.kind === 'place') {
          // A placing robot is done once it heads home; the next one takes its turn on the same mover.
          if (st.job < op.places.length) {
            if (!leftMover(robot)) break;
            const place = op.places[st.job];
            if (place.kind === 'assemble' && place.measure) st.result = robot.result;
            if (++st.job < op.places.length) {
              st.step = 'waitRobot';
              break;
            }
          }
          // The mover stays until the laser has finished marking.
          if (ps.laser) break;
        } else if (robot.job !== null) {
          break;
        }
      }
      st.stats.cycles++;
      const tag = recordCycle(s, cfg, i, st.result ?? { measurement: null });
      if (op.kind === 'reject' || op.kind === 'unload') {
        // The pen is in the gripper; drop it while the mover moves on.
        const toTray = op.kind === 'unload' && op.good;
        startJob(ps.robots[0], def.robots![0], 'drop', { dropTarget: toTray ? { kind: 'tray' } : { kind: 'bin', bin: op.bin } });
      }
      writeTag(s, cfg, i, tag);
      break;
    }

    case 'write':
      if (!r.done) break;
      r.done = false;
      if (r.ok) {
        if (st.tries >= cfg.rfid.maxTries) emit(s, { kind: 'station', process: processId(cfg, def), code: 'rfidWriteRecovered', message: 'RFID write recovered', carrier: carrierId(st.moverId!), logged: now(s) });
        release(s, i, false);
        break;
      }
      // Never release a mover whose tag doesn't match what was done to it: after the normal
      // retries the station holds it in fault and keeps retrying (as an operator would).
      if (++st.tries === cfg.rfid.maxTries) {
        emit(s, { kind: 'station', process: processId(cfg, def), code: 'rfidWriteFailed', message: 'RFID write failed: holding mover', carrier: carrierId(st.moverId!), logged: now(s) });
      }
      st.timer = st.tries >= cfg.rfid.maxTries ? cfg.rfid.stuckRetryDelay : cfg.rfid.retryDelay;
      st.step = 'retryWrite';
      break;

    case 'retryWrite':
      if (st.tries >= cfg.rfid.maxTries) st.status = 'fault';
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
 * A group member can take a mover that needs work if it isn't working or faulted and hasn't
 * already been promised one. Movers already processed upstream only pass through it, so they don't block.
 */
function memberFree(s: SimState, i: number): boolean {
  const p = s.plc.stations[i];
  const faulted = s.plant.stations[i].robots.some((r) => r.fault > 0) || p.status === 'fault';
  // A member holding a mover at its gate for the group isn't free either: that mover works there next.
  return !['working', 'waitRobot', 'waitGroup'].includes(p.step) && p.reserved === null && !faulted;
}

/**
 * N-up group: where the mover at member i should be worked on, or null to hold it at the gate for
 * now. Its own reservation keeps it here; a reservation further down sends it on; otherwise it
 * goes to the furthest member it can reach through free members (the next mover then takes the
 * one before it). If a member that is still working is in the way, the mover waits for it rather
 * than taking a member short of it: that member would block the path for a whole cycle and the
 * group would drift out of step. Waiting keeps the members filling and finishing together, like a
 * multi-up station.
 */
function groupTarget(s: SimState, cfg: LineConfig, i: number): number | null {
  const def = cfg.stations[i];
  const moverId = s.plc.stations[i].moverId;
  if (s.plc.stations[i].reserved === moverId) return i;
  const members = cfg.stations
    .map((_, j) => j)
    .filter((j) => cfg.stations[j].group === def.group)
    .sort((a, b) => cfg.stations[a].s - cfg.stations[b].s);
  const below = members.slice(members.indexOf(i) + 1);
  const promised = below.find((j) => s.plc.stations[j].reserved === moverId);
  if (promised !== undefined) return promised;
  let target = i;
  const blocker = below.find((j) => !memberFree(s, j));
  for (const j of below) {
    if (j === blocker) break;
    target = j;
  }
  // A member that is working will be free again soon; one promised to another mover won't be
  // passable, and one that is starved, blocked or faulted may take long.
  if (blocker !== undefined && s.plc.stations[blocker].status === 'working' && !s.plant.stations[blocker].robots.some((r) => r.fault > 0)) return null;
  if (target !== i) s.plc.stations[target].reserved = moverId;
  return target;
}

/** One place op per placing robot: a load robot starts a new pen, the others add their parts. */
function placeOps(def: StationDef, load: PlaceOp | null): PlaceOp[] {
  const robots = placers(def);
  return robots.map((r: RobotDef, k): PlaceOp => {
    if (r.step === 'body') return load!;
    const measure = k === robots.length - 1 ? (def.inspect?.key ?? null) : null;
    return { kind: 'assemble', parts: r.parts ?? [], fragile: !!def.fragile, measure };
  });
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
      return start(s, cfg, i, { kind: 'place', places: placeOps(def, { kind: 'load', srId, mark }) });
    }
    case 'assemble':
    case 'inspect': {
      if (tag.status !== 'ok' || stationSteps(def).every((x) => tag.done.includes(x))) return pass();
      const missing = (def.requires ?? []).filter((r) => !tag.done.includes(r));
      if (missing.length > 0) {
        // An upstream step was skipped (e.g. RFID no read): flag NOK so a reject station takes it out.
        st.status = 'passing';
        st.stats.passes++;
        return writeTag(s, cfg, i, { ...copyTag(tag), status: 'nok', reason: `Missing step: ${missing.join(', ')}` });
      }
      if (def.group) {
        const target = groupTarget(s, cfg, i);
        if (target === null) {
          st.step = 'waitGroup';
          return;
        }
        if (target !== i) return pass();
      }
      if (def.kind === 'inspect') {
        return start(s, cfg, i, { kind: 'inspect', measure: def.inspect!.key, noise: def.inspect!.noise, readCode: !!def.readsCode });
      }
      return start(s, cfg, i, { kind: 'place', places: placeOps(def, null) });
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
  // Only the mover a reservation is for uses it up; another mover's stays for when that one arrives.
  if (st.reserved === st.moverId) st.reserved = null;
  st.cycleStart = s.plant.t;
  st.status = 'working';
  st.op = op;
  st.job = 0;
  st.result = null;
  if (op.kind === 'inspect') {
    ps.camera!.cycle = { op, moverId: st.moverId!, mechLeft: def.mech, fixedLeft: def.fixed };
    ps.camera!.done = false;
    st.step = 'working';
  } else {
    st.step = 'waitRobot';
  }
}
