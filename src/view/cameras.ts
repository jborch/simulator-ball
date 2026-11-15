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
    title: 'Infeed · ST10 body load, ST20 spring, ST30 spring inspection',
    fov: 42,
    mount: { station: 'ST20', a: -0.05, y: 0.17, r: -0.6 },
    aim: { station: 'ST20', a: -0.05, y: 0.15, r: 0.05 },
  },
  {
    id: 'cartridge',
    name: 'Cartridge',
    title: 'Close-up · ST40A/B cartridge insertion',
    fov: 38,
    mount: { station: 'ST40A', a: 0.125, y: 0.13, r: -0.42 },
    aim: { station: 'ST40A', a: 0.125, y: 0.13, r: 0.0 },
  },
  {
    id: 'housing',
    name: 'Housing',
    title: 'Close-up · ST50 housing + cap snap',
    fov: 34,
    mount: { station: 'ST50', a: 0.0, y: 0.11, r: -0.36 },
    aim: { station: 'ST50', a: 0.0, y: 0.1, r: 0.0 },
  },
  {
    id: 'outfeed',
    name: 'Outfeed',
    title: 'Outfeed · ST60 final vision, ST70 tray packing and rejects',
    fov: 50,
    mount: { station: 'ST70', a: -0.55, y: 0.17, r: -0.68 },
    aim: { station: 'ST70', a: -0.55, y: 0.14, r: 0.05 },
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
