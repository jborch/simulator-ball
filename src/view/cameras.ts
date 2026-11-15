// Fixed monitoring cameras "installed" on the line. Positions are given in station-local
// coordinates (a along travel, y up from the belt surface, r outward from the belt; see build.ts),
// so they stay on their station if the layout changes. The close-ups sit on masts inside the loop
// and look outward across the belt, so the robot, the part on the mover and its feeder or nest
// are all in view and the gantry beam (on the far side) doesn't block it.
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
    fov: 48,
    mount: { station: 'ST20', a: -0.05, y: 1.1, r: -0.7 },
    aim: { station: 'ST20', a: -0.05, y: 0.15, r: 0.15 },
  },
  {
    id: 'cartridge',
    name: 'Cartridge',
    title: 'Close-up · ST40A/B cartridge insertion',
    fov: 40,
    mount: { station: 'ST40A', a: 0.125, y: 0.62, r: -0.48 },
    aim: { station: 'ST40A', a: 0.125, y: 0.16, r: 0.17 },
  },
  {
    id: 'housing',
    name: 'Housing',
    title: 'Close-up · ST50 housing + cap snap',
    fov: 40,
    mount: { station: 'ST50', a: -0.05, y: 0.5, r: -0.6 },
    aim: { station: 'ST50', a: 0.0, y: 0.18, r: 0.15 },
  },
  {
    id: 'outfeed',
    name: 'Outfeed',
    title: 'Outfeed · ST60 final vision, ST70 tray packing and rejects',
    fov: 42,
    mount: { station: 'ST70', a: -0.5, y: 1.0, r: -0.7 },
    aim: { station: 'ST70', a: -0.5, y: 0.15, r: 0.18 },
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
