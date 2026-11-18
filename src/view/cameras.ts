// Fixed monitoring cameras "installed" on the line. Positions are given in station-local
// coordinates (a along travel, y up from the belt surface, r outward from the belt; see build.ts),
// so they stay on their station if the layout changes. The station cameras stand on low masts
// inside the loop at about mover height and look level across the belt, like inspection cameras:
// they see each mover's side number label and the pen's DataMatrix, which both face the inside of
// the loop, with the robots, feeders and nests behind.
import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { pose } from '../sim/track';
import { BELT_Y } from './build';

export interface CameraDef {
  id: string;
  /** Short name for the selector. */
  name: string;
  /** What the camera monitors, for the on-screen label. */
  title: string;
  fov: number;
  /** Station-local mount and aim point. */
  mount: { station: string; a: number; y: number; r: number };
  aim: { station: string; a: number; y: number; r: number };
}

/** The overview isn't a fixed point: it frames the whole line for the current window shape. */
export const OVERVIEW = { id: 'overview', name: 'Overview', title: 'Line overview', direction: new THREE.Vector3(0.7, 1.7, 3.2) } as const;

export const CAMERAS: CameraDef[] = [
  {
    id: 'infeed',
    name: 'Infeed',
    title: 'Infeed · EM10 spring check, EM11 body load + spring, EM12 spring angle',
    fov: 46,
    mount: { station: 'EM11', a: 0.32, y: 0.17, r: -0.64 },
    aim: { station: 'EM11', a: 0.32, y: 0.15, r: 0.1 },
  },
  {
    id: 'springbase',
    name: 'Spring base',
    title: 'Spring base · EM13 orienter, EM14A–D presses (4-up), EM15 hook check',
    fov: 54,
    mount: { station: 'EM14B', a: 0.12, y: 0.17, r: -0.66 },
    aim: { station: 'EM14B', a: 0.12, y: 0.15, r: 0.1 },
  },
  {
    id: 'cartridge',
    name: 'Cartridge',
    title: 'Close-up · EM41A/B cartridge insertion',
    fov: 38,
    mount: { station: 'EM41A', a: 0.125, y: 0.13, r: -0.42 },
    aim: { station: 'EM41A', a: 0.125, y: 0.13, r: 0.0 },
  },
  {
    id: 'housing',
    name: 'Housing',
    title: 'Housing · EM30–EM32 label dial, EM40 snap',
    fov: 46,
    mount: { station: 'EM40', a: -0.05, y: 0.17, r: -0.5 },
    aim: { station: 'EM40', a: -0.05, y: 0.15, r: 0.3 },
  },
  {
    id: 'outfeed',
    name: 'Outfeed',
    title: 'Outfeed · EM50 final inspection, EM60 tray packing and rejects',
    fov: 50,
    mount: { station: 'EM60', a: -0.55, y: 0.17, r: -0.68 },
    aim: { station: 'EM60', a: -0.55, y: 0.14, r: 0.05 },
  },
];

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** Station-local point → world, matching how StationView places and turns its group. */
export function stationPoint(cfg: LineConfig, p: { station: string; a: number; y: number; r: number }): THREE.Vector3 {
  const def = cfg.stations.find((s) => s.id === p.station);
  if (!def) throw new Error(`camera on unknown station ${p.station}`);
  const at = pose(cfg.track, def.s);
  const v = new THREE.Vector3(p.a, p.y, -p.r).applyAxisAngle(new THREE.Vector3(0, 1, 0), at.heading);
  return v.add(new THREE.Vector3(at.x, BELT_Y, -at.y));
}

export function cameraPose(cfg: LineConfig, cam: CameraDef): CameraPose {
  return { position: stationPoint(cfg, cam.mount), target: stationPoint(cfg, cam.aim), fov: cam.fov };
}
