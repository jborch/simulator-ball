// Turns a finished station cycle into the new tag contents and MES records (ItemProcessed /
// ItemsMerged), and keeps counters (good, rejected, batch, tray, nest) up to date.
import type { Limits, LineConfig } from './config';
import { type RngState, random } from './rng';

/** Event logged with the first sample of a snap curve. */
export const SNAP_START = 'Snap Start';
import { carrierId, emit, measurementName, now, placers, processId, rejectProcessId, sourceProcessId, trayProcessId } from './machine';
import { copyTag, emptyTag } from './tags';
import type { CycleResult, ItemsMergedEvent, SimState, Tag } from './types';

type Props = Record<string, number | string | boolean | null>;

interface Evaluation {
  passed: boolean;
  cause: string | null;
  props: Props;
}

/** Checks a measurement against its limits, with the reject cause as the original line words it. */
export function evaluate(lim: Limits, value: number | null, rng: RngState): Evaluation {
  const passed = value !== null && value >= lim.lower && value <= lim.upper;
  const props: Props = {
    [measurementName(lim.key)]: value,
    'Inspection Value': value,
    'Inspection Lower Limit': lim.lower,
    'Inspection Upper Limit': lim.upper,
    'Inspection Passed': passed,
  };
  let cause: string | null = null;
  if (!passed) {
    if (value === null) cause = 'Part missing';
    else if (value > lim.upper && lim.high) cause = lim.high;
    else if (value < lim.lower && lim.low) cause = lim.low;
    else cause = lim.alt && random(rng) < lim.alt.p ? lim.alt.cause : lim.cause;
    props['Reject Cause'] = cause;
  }
  return { passed, cause, props };
}

function markNok(tag: Tag, cause: string | null): void {
  tag.status = 'nok';
  tag.reason = cause;
}

/**
 * Records station i's finished cycle on its current mover. Returns the tag to write back.
 * `result` is what the station's sensors measured (robot place or camera inspection).
 */
export function recordCycle(s: SimState, cfg: LineConfig, i: number, result: CycleResult): Tag {
  const def = cfg.stations[i];
  const st = s.plc.stations[i];
  const op = st.op!;
  const tag = copyTag(st.tag!);
  const process = processId(cfg, def);
  const carrier = carrierId(st.moverId!);
  const from = s.epochMs + st.cycleStart * 1000;
  const to = now(s);
  const identifier = (pen: number) => s.mes.identifiers[pen];

  switch (op.kind) {
    case 'place': {
      let tag = copyTag(st.tag!);
      const robots = placers(def);
      // Merges go out after the pen's record, so a new pen (load station) exists before parts go into it.
      const merges: ItemsMergedEvent[] = [];
      const sourceIds: { id: number; type: string }[] = [];
      op.places.forEach((place, k) => {
        if (place.kind === 'load') {
          // A new pen: its SR id and identifier go on the tag.
          tag = { srId: place.srId, status: 'ok', done: [], reason: null };
        } else {
          const pen = tag.srId!;
          place.parts.forEach((part, j) => {
            const partType = part[0].toUpperCase() + part.slice(1);
            // A part tracked on its sub-line (spring, spring base) was reported there already.
            const tracked = st.placed[k]?.[j] ?? null;
            const partId = tracked ?? ++s.plc.srCounter;
            sourceIds.push({ id: partId, type: partType });
            if (tracked !== null) {
              // Reported on its sub-line already. A labelled housing gives the pen its identifier.
              const id = s.mes.identifiers[tracked];
              if (id && part === 'housing') {
                s.mes.identifiers[pen] = id;
                delete s.mes.identifiers[tracked];
              }
            } else if (part === 'cartridge') {
              const source = sourceProcessId(cfg, def, robots[k]);
              // Cartridges are unpacked from the station's nest (1 nest → N cartridges).
              const nest = s.plc.nests[def.id];
              if (nest.used >= cfg.nestSize) {
                nest.srId = ++s.plc.srCounter;
                nest.used = 0;
              }
              emit(s, { kind: 'processed', process: source, scopedId: partId, itemType: partType, from, to, sourceScopedId: nest.srId, sourceType: 'Nest', sourcePosition: nest.used++ });
            } else {
              emit(s, { kind: 'processed', process: sourceProcessId(cfg, def, robots[k]), scopedId: partId, itemType: partType, from, to });
            }
            merges.push({ kind: 'merged', process, target: pen, targetType: 'Pen', source: partId, sourceType: partType, position: 0, logged: from });
          });
        }
        if (robots[k].step) tag.done.push(robots[k].step!);
      });
      const pen = tag.srId!;
      let props: Props = { 'Mover Id': carrier };
      let verdict: 'Passed' | 'Failed' | undefined;
      if (result.snap) {
        // Judged from the curve (EM40), with the original's snap properties.
        const { snap } = result;
        Object.assign(props, {
          'Peak Force': snap.peak,
          'Snap Position': snap.position,
          'Inspection Value': snap.peak,
          'Inspection Lower Limit': def.inspect!.lower,
          'Inspection Upper Limit': def.inspect!.upper,
          'Inspection Passed': snap.accepted,
        });
        if (snap.reason) Object.assign(props, { 'Failure Reason': snap.reason, 'Reject Cause': snap.reason });
        verdict = snap.accepted ? 'Passed' : 'Failed';
        if (!snap.accepted) markNok(tag, snap.reason);
      } else if (def.inspect) {
        const ev = evaluate(def.inspect!, result.measurement, s.rng);
        props = { ...props, ...ev.props };
        verdict = ev.passed ? 'Passed' : 'Failed';
        if (!ev.passed) markNok(tag, ev.cause);
      }
      if (def.logOnSource && sourceIds.length > 0) {
        // The station's record goes on the part it mounted (the pen's carrier still identifies the mover).
        const src = sourceIds.at(-1)!;
        emit(s, { kind: 'processed', process, scopedId: src.id, itemType: src.type, from, to, carrier, result: verdict, properties: props });
      } else {
        emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, identifier: identifier(pen), result: verdict, properties: props });
      }
      if (result.snap) {
        const { snap } = result;
        const item = def.logOnSource && sourceIds.length > 0 ? sourceIds.at(-1)!.id : pen;
        const start = s.epochMs + snap.end * 1000 - (snap.force.length - 1) * snap.interval;
        emit(s, { kind: 'series', process, scopedId: item, start, interval: snap.interval, values: { Force: snap.force, Displacement: snap.displacement }, startEvent: SNAP_START });
      }
      for (const m of merges) emit(s, m);
      return tag;
    }

    case 'inspect': {
      const pen = tag.srId!;
      const ev = evaluate(def.inspect!, result.measurement, s.rng);
      const props: Props = { 'Mover Id': carrier, ...ev.props };
      let { passed, cause } = ev;
      if (op.readCode) {
        props['Code Read'] = result.code ?? '';
        if (passed && result.code !== s.mes.identifiers[pen]) {
          passed = false;
          cause = result.code === null || result.code === undefined ? 'DataMatrix no read' : 'ID mismatch';
          props['Inspection Passed'] = false;
          props['Reject Cause'] = cause;
        }
      }
      tag.done.push(def.step!);
      if (!passed) markNok(tag, cause);
      emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, identifier: identifier(pen), result: passed ? 'Passed' : 'Failed', properties: props });
      return tag;
    }

    case 'reject':
    case 'unload':
      // The pen is in the gripper now; it's recorded as output once the drop is done (recordOutput).
      if (tag.srId !== null) {
        st.output = { pen: tag.srId, good: op.kind === 'unload' && op.good, cause: tag.reason ?? 'Incomplete', bin: op.bin, moverId: st.moverId!, start: st.cycleStart };
      }
      return emptyTag();
  }
}

/** Records a pen that station i's robot has dropped: into the tray (good) or a reject bin. */
export function recordOutput(s: SimState, cfg: LineConfig, i: number): void {
  const def = cfg.stations[i];
  const st = s.plc.stations[i];
  const out = st.output!;
  st.output = null;
  const process = processId(cfg, def);
  const carrier = carrierId(out.moverId);
  const from = s.epochMs + out.start * 1000;
  const to = now(s);
  const mes = s.mes;
  const batch = s.plc.batch;
  const moverStats = (mes.movers[out.moverId] ??= { pens: 0, rejects: 0 });
  const identifier = mes.identifiers[out.pen];
  if (out.good) {
    const tray = s.plc.tray;
    if (tray.count === 0) tray.start = s.plant.t;
    emit(s, { kind: 'processed', process, scopedId: out.pen, itemType: 'Pen', from, to, carrier, identifier, properties: { 'Mover Id': carrier, 'Tray Position': tray.count } });
    emit(s, { kind: 'merged', process: trayProcessId(cfg), target: tray.srId, targetType: 'Tray', source: out.pen, sourceType: 'Pen', position: tray.count, logged: to });
    tray.count++;
    mes.good++;
    moverStats.pens++;
    if (batch) batch.good++;
    if (tray.count >= cfg.traySize) closeTray(s, cfg);
  } else {
    emit(s, { kind: 'processed', process: rejectProcessId(cfg, def), scopedId: out.pen, itemType: 'Pen', from, to, carrier, identifier, properties: { 'Mover Id': carrier, 'Reject Cause': out.cause, Bin: out.bin } });
    mes.rejected++;
    mes.rejectsByCause[out.cause] = (mes.rejectsByCause[out.cause] ?? 0) + 1;
    moverStats.rejects++;
    if (batch) batch.rejected++;
  }
  delete mes.identifiers[out.pen];
}

/** Records the tray at the unload station as finished (full, or partly filled at the end of a batch) and starts a new one. */
export function closeTray(s: SimState, cfg: LineConfig): void {
  const tray = s.plc.tray;
  emit(s, { kind: 'processed', process: trayProcessId(cfg), scopedId: tray.srId, itemType: 'Tray', from: s.epochMs + tray.start * 1000, to: now(s), properties: { 'Tray Count': tray.count } });
  tray.srId = ++s.plc.srCounter;
  tray.count = 0;
}
