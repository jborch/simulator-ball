// Builds the compact per-frame view of the state that clients render (~30 Hz).
import type { LineConfig } from './config';
import type { Frame, RobotFrame, StationFrame } from './protocol';
import { tubSize } from './cartridges';
import type { CartridgeCell, Dial, Orienter, PlantStation, Robot, SimState } from './types';

function robotFrame(r: Robot): RobotFrame {
  const held = r.holding;
  const label = held?.kind === 'pen' ? held.load.mark || null : held?.kind === 'part' ? (held.label ?? null) : null;
  return { a: r.a, r: r.r, z: r.z, phase: r.phase, holding: held ? (held.kind === 'pen' ? [...held.load.parts] : [...held.parts]) : null, label };
}

/** 0..1 through the camera's current cycle, or null when it isn't inspecting. */
function cameraProgress(cfg: LineConfig, ps: PlantStation, i: number): number | null {
  const c = ps.camera?.cycle;
  const def = cfg.stations[i];
  const total = def.mech + def.fixed;
  if (!c || total <= 0) return null;
  return 1 - (Math.max(0, c.mechLeft) + Math.max(0, c.fixedLeft)) / total;
}

/** 0..1 through turning and measuring the current spring base. */
function orienterProgress(cfg: LineConfig, o: Orienter): number {
  const { mech, fixed } = cfg.orienter;
  if (o.phase === 'turning') return (1 - o.mechLeft / mech) * (mech / (mech + fixed));
  if (o.phase === 'measuring') return (mech + fixed - Math.max(0, o.fixedLeft)) / (mech + fixed);
  return o.phase === 'idle' ? 0 : 1;
}

/** The dial's housings by position, with what is printed on them, and what each position is doing. */
function dialFrame(cfg: LineConfig, d: Dial): Frame['dial'] {
  const state = (x: Dial['slots'][number]) => (!x ? 0 : x.ok === false ? 4 : x.inspected ? 3 : x.label ? 2 : 1);
  const running = (op: keyof Dial['jobs']) => d.jobs[op] !== null && d.jobs[op] !== 'done';
  return {
    slots: d.slots.map(state),
    labels: d.slots.map((x) => x?.label ?? null),
    turn: d.phase === 'index' ? 1 - Math.max(0, d.turn) / cfg.dial.index : 0,
    roll: d.roll,
    active: { load: running('load'), label: running('label'), inspect: running('inspect'), eject: running('eject') },
  };
}

/** EM41's cartridge supply: tub, EM00's robot (as its gantry's frame) and the collets. */
function cartridgeFrame(cfg: LineConfig, c: CartridgeCell): Frame['cartridges'] {
  const r = c.robot;
  return {
    used: c.tub?.used ?? tubSize(cfg),
    changing: c.changing,
    robot: { a: r.a, r: r.r, z: r.z, phase: r.phase, holding: r.holding && !['toPocket', 'down', 'grip'].includes(r.step) ? ['cartridge'] : null, label: null },
    collets: c.collets.map((x) => [x.u, x.cartridge ? 1 : 0]),
  };
}

export function buildFrame(s: SimState, cfg: LineConfig): Frame {
  const { plant, plc, mes } = s;
  const stations: StationFrame[] = plc.stations.map((st, i) => {
    const ps = plant.stations[i];
    return {
      id: st.id,
      status: st.status,
      gateClosed: ps.gateClosed,
      moverId: st.moverId,
      progress: cameraProgress(cfg, ps, i),
      robots: ps.robots.map(robotFrame),
      fault: Math.max(0, ...ps.robots.map((r) => r.fault)),
      laser: ps.laser !== null,
      scrap: plant.scrap[st.id] ?? 0,
    };
  });
  return {
    t: plant.t,
    epochMs: s.epochMs,
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
      srId: m.load?.srId ?? null,
      mark: m.load?.mark || null,
      laps: m.laps,
      lastLap: m.lastLap,
    })),
    stations,
    feeders: plant.feeders.map((f) => ({ id: f.id, items: f.items.map((it) => it.x), jam: f.jam })),
    orienter: { phase: plant.orienter.phase, progress: orienterProgress(cfg, plant.orienter) },
    dial: dialFrame(cfg, plant.dial),
    alarms: { ...plant.alarms },
    distribution: { items: plant.distribution.items.map((it) => it.x), cups: plant.distribution.cups.map((c) => (c.full ? 1 : c.filling > 0 ? 2 : 0)) },
    cartridges: cartridgeFrame(cfg, plant.cartridges),
    tray: {
      count: plant.tray.count,
      changing: plant.tray.changing,
      // Trays on the conveyor: [position, pens, state 0 moving, 1 being checked, 2 good, 3 rejected].
      line: plant.trayLine.trays.map((t) => [t.x, t.count, t.phase === 'checking' ? 1 : t.ok === null ? 0 : t.ok ? 2 : 3]),
      stacked: plant.trayLine.stacked,
      stack: plant.tray.stack,
      rejected: plant.trayLine.rejected,
    },
    batch: plc.batch ? { ...plc.batch } : null,
    batchSettings: { size: plc.batchSize, autoNext: plc.autoNext },
    counters: { good: mes.good, rejected: mes.rejected, retests: mes.retests, traysOut: plant.traysOut, bins: { ...plant.bins } },
  };
}
