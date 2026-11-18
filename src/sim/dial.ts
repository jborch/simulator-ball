// UN02's housing line on an indexing dial (EM30 load, EM31 label, EM32 label inspection, eject,
// unload to EM40). The plant turns the dial and does the work at each position; the PLC gives
// each housing its SR id and the identifier to print when it is loaded, records each step and
// decides at EM32 whether the housing goes on to EM40 or is pushed off (shift-register tracking).
import { raise } from './alarms';
import type { LineConfig } from './config';
import { makeIdentifier } from './gs1';
import { emit, now, subProcessId } from './machine';
import { evaluate } from './records';
import { type RngState, normal, random } from './rng';
import type { Dial, DialOp, DialPart, PlantState, SimState } from './types';

export function createDial(cfg: LineConfig): Dial {
  return { slots: new Array(cfg.dial.nests).fill(null), phase: 'dwell', turn: 0, jobs: { load: null, label: null, inspect: null, eject: null }, results: [], nextUid: 1, roll: cfg.faults.labelRoll };
}

/** The housing at the unload position, if it is ready for EM40's robot to take. */
export function dialPick(p: PlantState, cfg: LineConfig): DialPart | null {
  const part = p.dial.slots[cfg.dial.positions.unload];
  return p.dial.phase === 'dwell' && part?.ok === true ? part : null;
}

/** Takes the housing off the unload position (EM40's robot gripping it). */
export function takeFromDial(p: PlantState, cfg: LineConfig): DialPart {
  const part = dialPick(p, cfg)!;
  p.dial.slots[cfg.dial.positions.unload] = null;
  return part;
}

/**
 * One plant step of the dial. In a dwell each position starts its job when it has something to
 * do; the dial turns once every job is done and the unload position is empty.
 */
export function stepDial(p: PlantState, cfg: LineConfig, rng: RngState, dt: number): void {
  if (!p.feedersOn || p.alarms.dialJam > 0) return;
  const def = cfg.dial;
  const d = p.dial;
  const pos = def.positions;
  // An empty label roll stops labelling until the operator has changed it.
  if (d.roll <= 0 && cfg.faults.enabled) raise(p, cfg, rng, 'labelRoll');
  // An alarm that is up (also an injected one) always stops labelling; only depletion needs faults on.
  const rollReady = p.alarms.labelRoll === 0 && (!cfg.faults.enabled || d.roll > 0);
  if (d.phase === 'index') {
    d.turn -= dt * p.speed;
    if (d.turn > 0) return;
    // Every housing moves on one position.
    d.slots.unshift(d.slots.pop()!);
    d.phase = 'dwell';
    d.jobs = { load: null, label: null, inspect: null, eject: null };
    return;
  }

  const at = (op: DialOp) => d.slots[pos[op]];
  // What each position would do now, if anything; 'wait' blocks the dial without starting.
  const wants: Record<DialOp, boolean | 'wait'> = {
    load: !at('load') && p.feeders.find((f) => f.id === def.feeder)!.items[0]?.x === 0,
    // A housing is labelled once the PLC has given it its identifier.
    label: !!at('label') && !at('label')!.label ? (at('label')!.print && rollReady ? true : 'wait') : false,
    inspect: !!at('inspect')?.label && !at('inspect')!.inspected,
    // A checked housing waits for the PLC's verdict before it can be pushed off or go on.
    eject: at('eject')?.inspected ? (at('eject')!.ok === null ? 'wait' : !at('eject')!.ok) : false,
  };
  const time: Record<DialOp, number> = { load: def.load.mech, label: def.label.mech, inspect: def.inspect.fixed, eject: def.eject };
  const scales: Record<DialOp, boolean> = { load: true, label: true, inspect: false, eject: true };
  let busy = false;
  for (const op of ['load', 'label', 'inspect', 'eject'] as DialOp[]) {
    const job = d.jobs[op];
    if (job === null) {
      if (wants[op] === 'wait') busy = true;
      if (wants[op] === true) {
        d.jobs[op] = { left: time[op], from: p.t };
        if (op === 'load') p.feeders.find((f) => f.id === def.feeder)!.items.shift();
        busy = true;
      }
    } else if (job !== 'done') {
      busy = true;
      // A label going on stops with the roll; it carries on once a new roll is in.
      if (op === 'label' && !rollReady) continue;
      job.left -= scales[op] ? dt * p.speed : dt;
      if (job.left <= 0) {
        finish(p, cfg, rng, op, job.from);
        d.jobs[op] = 'done';
      }
    }
  }
  if (busy || d.slots[pos.unload]) return;
  d.phase = 'index';
  d.turn = def.index;
  // Now and then the dial jams on the turn and waits for the operator.
  if (cfg.faults.enabled && random(rng) < cfg.faults.dialJamPerIndex) raise(p, cfg, rng, 'dialJam');
}

function finish(p: PlantState, cfg: LineConfig, rng: RngState, op: DialOp, from: number): void {
  const d = p.dial;
  const pos = cfg.dial.positions;
  switch (op) {
    case 'load': {
      const part: DialPart = { uid: d.nextUid++, sr: null, print: null, ok: null, label: null, quality: null, inspected: false };
      d.slots[pos.load] = part;
      d.results.push({ op, uid: part.uid, from, to: p.t });
      return;
    }
    case 'label': {
      const part = d.slots[pos.label]!;
      const q = cfg.quality.labelQuality;
      part.label = part.print;
      if (cfg.faults.enabled) d.roll = Math.max(0, d.roll - 1);
      part.quality = normal(rng, q.mean, q.sd);
      d.results.push({ op, uid: part.uid, from, to: p.t });
      return;
    }
    case 'inspect': {
      const part = d.slots[pos.inspect]!;
      part.inspected = true;
      const value = part.quality! + normal(rng, 0, cfg.dial.inspect.inspect.noise);
      const code = random(rng) < cfg.dataMatrix.readFailRate ? null : part.label;
      d.results.push({ op, uid: part.uid, from, to: p.t, value, code });
      return;
    }
    case 'eject':
      d.slots[pos.eject] = null;
      p.bins[cfg.dial.inspect.id] = (p.bins[cfg.dial.inspect.id] ?? 0) + 1;
      return;
  }
}

/** PLC: SR ids and identifiers for loaded housings, records of EM30–EM32, and EM32's verdicts. */
export function scanDial(s: SimState, cfg: LineConfig): void {
  const d = s.plant.dial;
  const def = cfg.dial;
  const ms = (t: number) => s.epochMs + t * 1000;
  for (const r of d.results) {
    const part = d.slots.find((x) => x?.uid === r.uid);
    if (!part) continue;
    switch (r.op) {
      case 'load': {
        part.sr = ++s.plc.srCounter;
        part.print = makeIdentifier(s.rng, cfg.gs1.gtin, now(s), cfg.gs1.expiryYears);
        s.mes.identifiers[part.sr] = part.print;
        emit(s, { kind: 'processed', process: subProcessId(cfg, def.load), scopedId: part.sr, itemType: 'Housing', from: ms(r.from), to: ms(r.to) });
        break;
      }
      case 'label':
        // The original's AddIdentifier: the housing's record at EM31 carries the identifier it now wears.
        emit(s, { kind: 'processed', process: subProcessId(cfg, def.label), scopedId: part.sr!, itemType: 'Housing', from: ms(r.from), to: ms(r.to), identifier: part.label! });
        break;
      case 'inspect': {
        const ev = evaluate(def.inspect.inspect, r.value ?? null, s.rng);
        let { passed, cause } = ev;
        const props = { ...ev.props, 'Code Read': r.code ?? '' };
        if (passed && r.code !== part.print) {
          passed = false;
          cause = r.code === null ? 'Label unreadable' : 'Label misprinted';
          Object.assign(props, { 'Inspection Passed': false, 'Inspection Result': 0, 'Reject Cause': cause });
        }
        part.ok = passed;
        if (!passed) delete s.mes.identifiers[part.sr!];
        emit(s, { kind: 'processed', process: subProcessId(cfg, def.inspect), scopedId: part.sr!, itemType: 'Housing', from: ms(r.from), to: ms(r.to), identifier: part.label ?? undefined, result: passed ? 'Passed' : 'Failed', properties: props });
        break;
      }
    }
  }
  d.results = [];
}
