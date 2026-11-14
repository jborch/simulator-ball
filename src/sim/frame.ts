// Builds the compact per-frame view of the state that clients render (~30 Hz).
import type { LineConfig } from './config';
import type { Frame, RobotFrame, StationFrame } from './protocol';
import type { PlantStation, Robot, SimState } from './types';

function robotFrame(r: Robot): RobotFrame {
  const held = r.holding;
  return { a: r.a, r: r.r, z: r.z, phase: r.phase, holding: held ? (held.kind === 'pen' ? [...held.load.parts] : [...held.parts]) : null };
}

/** 0..1 through the camera's current cycle, or null when it isn't inspecting. */
function cameraProgress(cfg: LineConfig, ps: PlantStation, i: number): number | null {
  const c = ps.camera?.cycle;
  const def = cfg.stations[i];
  const total = def.mech + def.fixed;
  if (!c || total <= 0) return null;
  return 1 - (Math.max(0, c.mechLeft) + Math.max(0, c.fixedLeft)) / total;
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
      robot: ps.robot ? robotFrame(ps.robot) : null,
      fault: ps.robot?.fault ?? 0,
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
    feeders: plant.feeders.map((f) => ({ id: f.id, items: [...f.items], jam: f.jam })),
    nests: plant.nests.map((n) => ({ station: n.station, slots: [...n.slots], changing: n.changing })),
    tray: { count: plant.tray.count, changing: plant.tray.changing, queue: [...plant.trayQueue] },
    batch: plc.batch ? { ...plc.batch } : null,
    batchSettings: { size: plc.batchSize, autoNext: plc.autoNext },
    counters: { good: mes.good, rejected: mes.rejected, traysOut: plant.traysOut, bins: { ...plant.bins } },
  };
}
