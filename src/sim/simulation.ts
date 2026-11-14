import { LINE, type LineConfig } from './config';
import { createPlant, stepPlant } from './plant';
import { applyCommand, createPlc, scanPlc } from './plc';
import type { Command, Frame } from './protocol';
import type { SimEvent, SimState } from './types';

export interface SimOptions {
  seed?: number;
  /** Wall-clock time that sim time 0 corresponds to (for event timestamps). */
  epochMs?: number;
  cfg?: LineConfig;
}

/** Headless line: plant + PLC + MES, stepped in fixed increments. Pure; no timers or DOM. */
export class Simulation {
  readonly cfg: LineConfig;
  state: SimState;
  private acc = 0;
  private tick = 0;
  private readonly stepsPerScan: number;

  constructor(opts: SimOptions = {}) {
    this.cfg = opts.cfg ?? LINE;
    const rng = { seed: opts.seed ?? 1 };
    this.state = {
      epochMs: opts.epochMs ?? 0,
      rng,
      plant: createPlant(this.cfg, rng),
      plc: createPlc(this.cfg),
      mes: { identifiers: {}, good: 0, rejected: 0, rejectsByCause: {}, movers: {}, events: [] },
    };
    this.stepsPerScan = Math.round(this.cfg.plcScan / this.cfg.plantDt);
  }

  command(cmd: Command, origin = 'local'): boolean {
    return applyCommand(this.state, this.cfg, cmd, origin);
  }

  /** Advances sim time by `seconds` (real time when driven by the worker). */
  advance(seconds: number): void {
    const dt = this.cfg.plantDt;
    this.acc += seconds;
    while (this.acc >= dt) {
      this.acc -= dt;
      stepPlant(this.state.plant, this.cfg, this.state.rng, dt);
      if (++this.tick % this.stepsPerScan === 0) scanPlc(this.state, this.cfg, this.cfg.plcScan);
    }
  }

  drainEvents(): SimEvent[] {
    const e = this.state.mes.events;
    this.state.mes.events = [];
    return e;
  }

  frame(): Frame {
    const { plant, plc, mes } = this.state;
    return {
      t: plant.t,
      epochMs: this.state.epochMs,
      machine: plc.machine,
      speed: plant.speed,
      speedTarget: plc.speedTarget,
      beltSpeed: plant.beltSpeed,
      movers: plant.movers.map((m) => ({
        id: m.id,
        s: m.s,
        v: m.v,
        status: m.tag.status,
        parts: m.load ? [...m.load.parts] : [],
        laps: m.laps,
        lastLap: m.lastLap,
      })),
      stations: plc.stations.map((st, i) => {
        const c = plant.stations[i].cycle;
        const def = this.cfg.stations[i];
        const total = def.mech + def.fixed;
        const left = c ? Math.max(0, c.mechLeft) + Math.max(0, c.fixedLeft) : 0;
        return {
          id: st.id,
          status: st.status,
          gateClosed: plant.stations[i].gateClosed,
          moverId: st.moverId,
          progress: c && total > 0 ? 1 - left / total : null,
        };
      }),
      counters: {
        good: mes.good,
        rejected: mes.rejected,
        traysOut: plant.traysOut,
        trayFill: plant.trayFill,
        bins: { ...plant.bins },
      },
    };
  }
}
