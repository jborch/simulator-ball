// Turns a finished station cycle into the new tag contents and MES records (ItemProcessed /
// ItemsMerged), and keeps counters (good, rejected, batch, tray, nest) up to date.
import type { LineConfig, StationDef } from './config';
import { carrierId, emit, now, processId } from './machine';
import { copyTag, emptyTag } from './tags';
import type { CycleResult, SimState, Tag } from './types';

type Props = Record<string, number | string | boolean>;

interface Evaluation {
  passed: boolean;
  cause: string | null;
  props: Props;
}

function evaluate(def: StationDef, value: number | null): Evaluation {
  const lim = def.inspect!;
  const passed = value !== null && value >= lim.lower && value <= lim.upper;
  const props: Props = {
    'Inspection Value': value ?? Number.NaN,
    'Inspection Lower Limit': lim.lower,
    'Inspection Upper Limit': lim.upper,
    'Inspection Passed': passed,
  };
  let cause: string | null = null;
  if (!passed) {
    cause = value === null ? 'Part missing' : value > lim.upper ? `${lim.cause} (high)` : `${lim.cause} (low)`;
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

  switch (op.kind) {
    case 'load':
      emit(s, { kind: 'processed', process, scopedId: op.srId, itemType: 'Pen', from, to, carrier, identifier: op.mark, properties: { 'Mover Id': carrier } });
      return { srId: op.srId, status: 'ok', done: ['body'], reason: null };

    case 'assemble': {
      const pen = tag.srId!;
      for (const part of op.parts) {
        const partId = ++s.plc.srCounter;
        const partType = part[0].toUpperCase() + part.slice(1);
        if (part === 'cartridge') {
          // Cartridges are unpacked from the station's nest (1 nest → N cartridges).
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
      let props: Props = { 'Mover Id': carrier };
      let verdict: 'Passed' | 'Failed' | undefined;
      if (def.inspect) {
        const ev = evaluate(def, result.measurement);
        props = { ...props, ...ev.props };
        verdict = ev.passed ? 'Passed' : 'Failed';
        if (!ev.passed) markNok(tag, ev.cause);
      }
      emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, result: verdict, properties: props });
      return tag;
    }

    case 'inspect': {
      const pen = tag.srId!;
      const ev = evaluate(def, result.measurement);
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
      emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, result: passed ? 'Passed' : 'Failed', properties: props });
      return tag;
    }

    case 'reject':
    case 'unload': {
      const pen = tag.srId;
      if (pen === null) return emptyTag();
      const mes = s.mes;
      const batch = s.plc.batch;
      const moverStats = (mes.movers[st.moverId!] ??= { pens: 0, rejects: 0 });
      if (op.kind === 'unload' && op.good) {
        const tray = s.plc.tray;
        emit(s, { kind: 'merged', process, target: tray.srId, source: pen, sourceType: 'Pen', position: tray.count, logged: from });
        emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, properties: { 'Mover Id': carrier, 'Tray Position': tray.count } });
        tray.count++;
        mes.good++;
        moverStats.pens++;
        if (batch) batch.good++;
        if (tray.count >= cfg.traySize) {
          emit(s, { kind: 'processed', process, scopedId: tray.srId, itemType: 'Tray', from, to, properties: { Count: tray.count } });
          tray.srId = ++s.plc.srCounter;
          tray.count = 0;
        }
      } else {
        const cause = tag.reason ?? 'Incomplete';
        emit(s, { kind: 'processed', process, scopedId: pen, itemType: 'Pen', from, to, carrier, properties: { 'Mover Id': carrier, 'Reject Cause': cause, Bin: op.bin } });
        mes.rejected++;
        mes.rejectsByCause[cause] = (mes.rejectsByCause[cause] ?? 0) + 1;
        moverStats.rejects++;
        if (batch) batch.rejected++;
      }
      delete mes.identifiers[pen];
      return emptyTag();
    }
  }
}
