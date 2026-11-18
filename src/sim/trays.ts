// UN03's tray line. EM60 packs pens into the tray at its packing position; a full tray (or the
// part-filled last tray of a batch) indexes out onto a conveyor while the destacker drops the next
// empty one into place. The conveyor stops each tray under EM61's camera, then takes it to the
// outfeed stack, or pushes it into the reject rack. The PLC tracks each tray by its SR id (shift
// register), records EM61 and counts the batch's output in trays, as the original's last process.
import { raise } from './alarms';
import type { LineConfig } from './config';
import { emit, subProcessId } from './machine';
import { evaluate } from './records';
import { type RngState, normal } from './rng';
import type { PlantState, SimState, TrayLine } from './types';

export function createTrayLine(): TrayLine {
  return { trays: [], stacked: 0, rejected: 0, results: [] };
}

/**
 * Indexes the tray out (full, or partly filled on a discharge request) onto the conveyor once the
 * unload robot's gripper is clear of it and there is room, then the destacker brings the next
 * empty tray into place (the change time). The PLC gives that one its SR id.
 */
export function stepTray(p: PlantState, cfg: LineConfig, rng: RngState, toolClear: boolean, dt: number): void {
  const t = p.tray;
  const packAt = cfg.layout.tray.a;
  if (t.changing > 0) {
    t.changing -= dt;
    if (t.changing <= 0) t.changing = 0;
  } else if (t.discharge && t.count === 0) {
    t.discharge = false;
  } else if (toolClear && (t.count >= cfg.traySize || (t.discharge && t.count > 0))) {
    const room = p.trayLine.trays.every((x) => x.x - packAt >= cfg.trays.pitch);
    if (!room) return;
    // No empty tray to follow: the destacker waits for the operator to refill it.
    if (cfg.faults.enabled && (t.stack <= 0 || p.alarms.destacker > 0)) {
      raise(p, cfg, rng, 'destacker');
      return;
    }
    if (cfg.faults.enabled) t.stack--;
    const q = cfg.quality.trayCheck;
    p.trayLine.trays.push({ sr: t.sr, count: t.count, x: packAt, phase: 'toCheck', mechLeft: 0, fixedLeft: 0, from: 0, quality: normal(rng, q.mean, q.sd), ok: null });
    p.pensOut += t.count;
    p.traysOut++;
    t.count = 0;
    t.sr = null;
    t.discharge = false;
    t.changing = cfg.trayChange;
  }
}

/** Trays ride the conveyor, stop for EM61, then go to the stack or the reject rack. */
export function stepTrayLine(p: PlantState, cfg: LineConfig, rng: RngState, dt: number): void {
  // The conveyor and EM61 run with the line: nothing moves or is checked while stopped or held.
  if (!p.feedersOn) return;
  const line = p.trayLine;
  const def = cfg.trays;
  const check = def.check;
  line.trays.forEach((tr, i) => {
    switch (tr.phase) {
      case 'checking':
        if (tr.mechLeft > 0) tr.mechLeft -= dt * p.speed;
        else tr.fixedLeft -= dt;
        if (tr.mechLeft <= 0 && tr.fixedLeft <= 0) {
          line.results.push({ sr: tr.sr, count: tr.count, value: tr.quality + normal(rng, 0, check.inspect.noise), from: tr.from, to: p.t });
          tr.phase = 'decide';
        }
        return;
      case 'decide':
        if (tr.ok !== null) tr.phase = 'out';
        return;
      default: {
        // Moving: to the camera first, then to the end; never into the tray ahead.
        const target = tr.phase === 'toCheck' ? check.a : def.end;
        const ahead = i === 0 ? Infinity : line.trays[i - 1].x - def.pitch;
        tr.x = Math.min(tr.x + def.speed * p.speed * dt, target, ahead);
        if (tr.phase === 'toCheck' && tr.x >= check.a) {
          tr.phase = 'checking';
          tr.mechLeft = check.mech;
          tr.fixedLeft = check.fixed;
          tr.from = p.t;
        }
      }
    }
  });
  // At the end a good tray goes onto the stack, a rejected one into the rack.
  while (line.trays.length > 0 && line.trays[0].phase === 'out' && line.trays[0].x >= def.end) {
    const tr = line.trays.shift()!;
    if (tr.ok) line.stacked++;
    else line.rejected++;
  }
}

/** PLC: the tray's SR id goes with the tray (shift register); EM61's records and verdicts; batch output. */
export function scanTrays(s: SimState, cfg: LineConfig): void {
  const { plant, plc } = s;
  // A fresh empty tray in place takes the SR id the PLC is packing into.
  if (plant.tray.sr === null && plant.tray.changing === 0 && plant.tray.count === 0) plant.tray.sr = plc.tray.srId;
  const check = cfg.trays.check;
  for (const r of plant.trayLine.results) {
    const tray = plant.trayLine.trays.find((x) => x.sr === r.sr && x.phase === 'decide');
    const ev = evaluate(check.inspect, r.value, s.rng);
    let { passed } = ev;
    const props: Record<string, string | number | boolean | null> = { ...ev.props, 'Tray Count': r.count };
    // A tray that isn't full is short, whatever else the camera sees.
    if (r.count < cfg.traySize) {
      passed = false;
      Object.assign(props, { 'Inspection Passed': false, 'Reject Cause': 'Tray packing incomplete' });
    }
    if (tray) tray.ok = passed;
    if (r.sr !== null) {
      emit(s, { kind: 'processed', process: subProcessId(cfg, check), scopedId: r.sr, itemType: 'Tray', from: s.epochMs + r.from * 1000, to: s.epochMs + r.to * 1000, result: passed ? 'Passed' : 'Failed', properties: props });
    }
    const b = plc.batch;
    if (b) {
      if (passed) b.trays++;
      else b.traysRejected++;
    }
  }
  plant.trayLine.results = [];
}
