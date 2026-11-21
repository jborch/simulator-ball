// Shared materials, dimensions and small geometry helpers for the 3D view.
// Station-local coordinates: a along travel, y up from the belt surface, r outward from the belt.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Pose } from '../sim/track';

/** Belt surface height above the floor. Station groups sit at this height. */
export const BELT_Y = 0.9;
/** Table top, relative to the belt surface. */
export const TABLE = -0.06;
export const BELT_W = 0.13;
export const RIB = 0.05;
export const RAIL_Y = 0.56;

export const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });

export const M = {
  /** Conveyor side profiles and brackets: clear-anodised like the frame extrusions. */
  frame: mat(0xa9b1b9, { metalness: 0.8, roughness: 0.36 }),
  table: mat(0x5b6370, { roughness: 0.8 }),
  rail: mat(0xd2d6da, { metalness: 1, roughness: 0.17 }),
  axis: mat(0x627578, { metalness: 0.85, roughness: 0.32 }),
  axisDark: mat(0x323b3d, { metalness: 0.8, roughness: 0.34 }),
  camera: mat(0x22252a),
  lens: mat(0x111111, { metalness: 0.9, roughness: 0.1 }),
  pin: mat(0xa0a9a6, { metalness: 0.82, roughness: 0.32 }),
  bin: mat(0x607879, { roughness: 0.7 }),
  /** Vibratory bowls: satin (bead-blasted) stainless. */
  bowl: mat(0xb0b5ba, { metalness: 1, roughness: 0.3, side: THREE.DoubleSide }),
  nest: mat(0xf2f2f2, { roughness: 0.7 }),
  /** Vibratory drive housings and other dark machine parts. */
  drive: mat(0x3a3f45, { metalness: 0, roughness: 0.46 }),
  laser: new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85 }),
};

export const LIGHT_COLORS = { red: 0xff3b30, yellow: 0xffc400, green: 0x34c759, blue: 0x2f7cf6 } as const;
export type LightColor = keyof typeof LIGHT_COLORS;

/** Station-local (a along travel, y up, r outward) → three local coordinates of a station group. */
export const local = (a: number, y: number, r: number) => new THREE.Vector3(a, y, -r);

export function v3(x: number, yPlan: number, h: number): THREE.Vector3 {
  return new THREE.Vector3(x, h, -yPlan);
}

export function side(p: Pose, offset: number): { x: number; y: number } {
  return { x: p.x - Math.sin(p.heading) * offset, y: p.y + Math.cos(p.heading) * offset };
}

export function label(text: string, cls = 'label'): CSS2DObject {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  return new CSS2DObject(div);
}

export function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Box spanning station-local ranges a0..a1, y0..y1, r0..r1. */
export function span(a0: number, a1: number, y0: number, y1: number, r0: number, r1: number, m: THREE.Material): THREE.Mesh {
  const b = box(Math.abs(a1 - a0), Math.abs(y1 - y0), Math.abs(r1 - r0), m);
  b.position.copy(local((a0 + a1) / 2, (y0 + y1) / 2, (r0 + r1) / 2));
  return b;
}

export function cyl(r: number, h: number, m: THREE.Material, seg = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Reach {
  aMin: number;
  aMax: number;
  rMin: number;
  rMax: number;
}
