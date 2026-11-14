// Device positions in station-local coordinates (a along travel, r outward from the belt
// centre). Shared by the robots (where to move) and the 3D view (where to draw).
import type { LineConfig } from './config';

export interface Point {
  a: number;
  r: number;
}

function grid(slot: number, g: { a: number; r: number; cols: number; rows: number; pitch: number }): Point {
  const col = slot % g.cols;
  const row = Math.floor(slot / g.cols);
  return { a: g.a + (col - (g.cols - 1) / 2) * g.pitch, r: g.r + (row - (g.rows - 1) / 2) * g.pitch };
}

/** Pocket of a cartridge nest (each nest-fed station has its own nest at the same local spot). */
export function nestPocket(cfg: LineConfig, slot: number): Point {
  return grid(slot, cfg.layout.nest);
}

/** Pocket of the outfeed tray at the unload station. */
export function trayPocket(cfg: LineConfig, slot: number): Point {
  return grid(slot, cfg.layout.tray);
}
