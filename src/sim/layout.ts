// Device positions in station-local coordinates (a along travel, r outward from the belt
// centre). Shared by the robots (where to move) and the 3D view (where to draw).
import type { LineConfig, PartType } from './config';

export interface Point {
  a: number;
  r: number;
}

function grid(slot: number, g: { a: number; r: number; cols: number; rows: number; pitch: number }): Point {
  const col = slot % g.cols;
  const row = Math.floor(slot / g.cols);
  return { a: g.a + (col - (g.cols - 1) / 2) * g.pitch, r: g.r + (row - (g.rows - 1) / 2) * g.pitch };
}

/** Pocket of the outfeed tray at the unload station. */
export function trayPocket(cfg: LineConfig, slot: number): Point {
  return grid(slot, cfg.layout.tray);
}

/**
 * Length from the bottom of a held thing to its top, where the gripper holds it: a loose part
 * (or the housing with its cap), or a pen in any state of assembly (contains the body).
 */
export function heldLength(cfg: LineConfig, parts: readonly PartType[]): number {
  const g = parts.map((p) => cfg.parts[p]);
  return Math.max(...g.map((x) => x.seat + x.length)) - Math.min(...g.map((x) => x.seat));
}

/** Radius of the part at the top of a held thing, where the gripper jaws close. */
export function gripRadius(cfg: LineConfig, parts: readonly PartType[]): number {
  const top = (p: PartType) => cfg.parts[p].seat + cfg.parts[p].length;
  return cfg.parts[parts.reduce((a, b) => (top(b) > top(a) ? b : a))].radius;
}

/** Gripper tip height (above the belt) that holds these parts exactly where they sit on a mover. */
export function seatedTip(cfg: LineConfig, parts: readonly PartType[]): number {
  const g = parts.map((p) => cfg.parts[p]);
  return cfg.mover.seat + Math.max(...g.map((x) => x.seat + x.length));
}
