import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { cells } from './cells';
import { BELT_Y, TABLE, mat } from './build';
import { batch, block, finish, hardware, hose, plate, profile, round, warning } from './hardware';
import { applyContactMap } from './occlusion';
import { brushedFinish } from './textures';
import { contactPatch } from './hall';

// Brushed stainless deck plates: their look is the room they reflect.
const deck = mat(0xa3a8a9, { roughness: 0.4, roughnessMap: brushedFinish(), metalness: 1 });
const topFinish = deck.clone();
const rubber = finish.seal;
const dark = finish.graphite;
const enameled = finish.powder;
const trim = finish.zinc;
const amber = mat(0xe5b542);
const red = mat(0xac312b, { roughness: 0.38 });
/** Grey PVC wiring duct and its slightly lighter lid. */
const ductGrey = mat(0x8f9592, { roughness: 0.62, metalness: 0.02 });
const ductLid = mat(0x9ca29f, { roughness: 0.55, metalness: 0.02 });
const top = BELT_Y + TABLE;

function levelFoot(g: THREE.Group, x: number, z: number): void {
  round(g, x, 0.012, z, 0.044, 0.023, rubber);
  round(g, x, 0.027, z, 0.032, 0.009, trim);
  round(g, x, 0.066, z, 0.009, 0.076, trim, 12);
  round(g, x, 0.08, z, 0.015, 0.009, dark, 6);
  block(g, x, 0.098, z, 0.065, 0.015, 0.065, dark);
  contactPatch(g, x, 0.004, z, 0.21, 0.19);
}

/** Printed touchscreen under a single glass cover. */
function screen(): THREE.Material {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 300;
  const p = c.getContext('2d')!;
  p.fillStyle = '#15292f';
  p.fillRect(0, 0, 512, 300);
  p.fillStyle = '#286667';
  p.fillRect(0, 0, 512, 57);
  p.fillStyle = '#e6efea';
  p.font = 'bold 26px Arial';
  p.fillText('L07   /   LINE CONTROL', 18, 38);
  p.font = '18px Arial';
  p.fillText('AUTOMATIC', 20, 102);
  p.fillText('Station overview', 20, 156);
  for (let i = 0; i < 6; i++) {
    p.fillStyle = '#68b6a4';
    p.fillRect(19 + i * 80, 175, 62, 37);
    p.fillStyle = '#34525a';
    p.fillRect(19 + i * 80, 222, 62, 26);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return mat(0xffffff, { map: tex, roughness: 0.2, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.22 });
}

function consolePanel(g: THREE.Group, x: number, z: number): void {
  profile(g, [x - 0.12, top, z - 0.1], [x - 0.12, 1.15, z - 0.1], 0.037);
  block(g, x - 0.04, 1.15, z - 0.1, 0.18, 0.037, 0.038, dark);
  round(g, x, 1.15, z - 0.057, 0.024, 0.08, dark).rotation.x = Math.PI / 2;
  block(g, x, 1.16, z - 0.024, 0.278, 0.184, 0.019, dark);
  block(g, x, 1.16, z, 0.3, 0.206, 0.055, enameled);
  block(g, x - 0.018, 1.176, z + 0.029, 0.235, 0.134, 0.013, rubber);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.111), screen());
  panel.position.set(x - 0.018, 1.177, z + 0.036);
  g.add(panel);
  for (const [dx, color, r] of [
    [0.098, red, 0.016],
    [-0.087, dark, 0.008],
    [-0.052, finish.pipe, 0.008],
  ] as const) {
    round(g, x + dx, 1.089, z + 0.033, r * 1.35, 0.006, dx > 0 ? amber : trim).rotation.x = Math.PI / 2;
    round(g, x + dx, 1.089, z + 0.043, r, 0.016, color).rotation.x = Math.PI / 2;
  }
  plate(g, x + 0.057, 1.195, z - 0.035, 0.078, 0.025, 'HMI 07', '24 VDC', '#276c6e', Math.PI);
  round(g, x, 1.12, z - 0.038, 0.009, 0.012, trim, 12).rotation.x = Math.PI / 2;
  hose(
    g,
    [
      [x, 1.12, z - 0.043],
      [x, 1.04, z - 0.064],
      [x - 0.12, 1.055, z - 0.12],
      [x - 0.12, top, z - 0.12],
    ],
    0.006,
  );
}

/** A glazed outer access panel. Narrow hardware and clear work zone on the belt side. */
function guard(g: THREE.Group, x: number, z: number, w: number, h: number): void {
  const bottom = top + 0.055;
  for (const dx of [-w / 2, w / 2]) {
    profile(g, [x + dx, top, z], [x + dx, top + h, z], 0.025);
    block(g, x + dx, top + 0.007, z, 0.055, 0.014, 0.055, dark);
  }
  for (const y of [bottom, top + h - 0.012]) profile(g, [x - w / 2, y, z], [x + w / 2, y, z], 0.024);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.024, h - 0.078), finish.glass);
  pane.position.set(x, top + (h + 0.045) / 2, z);
  g.add(pane);
  warning(g, x - w * 0.33, top + 0.122, z + 0.003, 0.079);
  for (const y of [0.13, h - 0.08]) block(g, x - w / 2 + 0.012, top + y, z + 0.015, 0.035, 0.039, 0.016, dark);
  for (const y of [0.21, 0.28]) block(g, x + w / 2 - 0.044, top + y, z + 0.017, 0.012, 0.012, 0.033, dark);
  block(g, x + w / 2 - 0.044, top + 0.245, z + 0.033, 0.013, 0.083, 0.015, rubber);
}

function bench(
  root: THREE.Group,
  x: number,
  z: number,
  w: number,
  d: number,
  name: string,
  detail: string,
  closed: boolean,
  guardWidth: number,
  hmi = false,
  /** How far the top reaches past the frame toward -x and +x (world), to meet the next bench. */
  reach: [number, number] = [0, 0],
): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  if (z < 0) g.rotation.y = Math.PI;
  const end = w / 2 - 0.074,
    side = d / 2 - 0.064;
  // Tops of neighbouring benches butt together (the group is turned for z < 0).
  const [left, right] = z < 0 ? [reach[1], reach[0]] : reach;
  block(g, (right - left) / 2, top - 0.013, 0, w + left + right, 0.026, d, topFinish);
  // Edge band of the top plate.
  block(g, (right - left) / 2, top - 0.022, d / 2 + 0.0006, w + left + right, 0.008, 0.0012, trim);
  for (const dz of [-side, side]) {
    profile(g, [-end, 0.765, dz], [end, 0.765, dz], 0.055);
    profile(g, [-end, 0.2, dz], [end, 0.2, dz], 0.045);
    for (const dx of [-end, end]) {
      profile(g, [dx, 0.104, dz], [dx, top - 0.023, dz], 0.05);
      levelFoot(g, dx, dz);
    }
  }
  for (const dx of [-end, end]) profile(g, [dx, 0.2, -side], [dx, 0.2, side], 0.045);
  if (closed) {
    block(g, 0, 0.488, 0, w - 0.16, 0.566, d - 0.13, dark);
    const doors = Math.max(2, Math.round(w / 0.57));
    const width = (w - 0.17) / doors;
    for (let i = 0; i < doors; i++) {
      const cx = (i + 0.5 - doors / 2) * width;
      block(g, cx, 0.488, side + 0.006, width - 0.008, 0.552, 0.024, enameled);
      block(g, cx + width * 0.34, 0.53, side + 0.024, 0.023, 0.088, 0.017, dark);
      for (const dy of [0.28, 0.68]) block(g, cx - width * 0.45, dy, side + 0.023, 0.012, 0.047, 0.011, trim);
      if (i === 0) {
        for (let j = 0; j < 8; j++) block(g, cx, 0.311 + j * 0.012, side + 0.019, width * 0.51, 0.004, 0.003, dark);
      }
    }
    plate(g, -w * 0.25, 0.662, side + 0.019, 0.17, 0.053, name, detail);
  } else {
    block(g, 0, 0.225, 0, w - 0.17, 0.02, d - 0.15, deck);
    block(g, 0, 0.48, -side + 0.04, w - 0.13, 0.13, 0.08, dark);
    for (let i = 0; i < 4; i++)
      hose(
        g,
        [
          [-end, 0.62 + i * 0.012, -side],
          [0, 0.52 + i * 0.012, -side],
          [end, 0.62 + i * 0.012, -side],
        ],
        0.005,
        i === 0 ? finish.pipe : rubber,
      );
  }
  // Slotted PVC wiring duct along the operator edge: fingers on both sides, a clip-on lid,
  // end caps, and cables leaving through the slots at the service points.
  const trayZ = side - 0.044;
  const ductW = w - 0.15;
  block(g, 0, top + 0.0015, trayZ, ductW, 0.003, 0.04, ductGrey);
  for (const dz of [-0.0185, 0.0185]) {
    block(g, 0, top + 0.006, trayZ + dz, ductW, 0.006, 0.003, ductGrey);
    for (let xx = -ductW / 2 + 0.006; xx < ductW / 2 - 0.004; xx += 0.012) block(g, xx, top + 0.022, trayZ + dz, 0.0075, 0.026, 0.003, ductGrey);
  }
  block(g, 0, top + 0.037, trayZ, ductW + 0.002, 0.004, 0.044, ductGrey);
  block(g, 0, top + 0.0396, trayZ, ductW - 0.01, 0.0012, 0.03, ductLid);
  for (const xx of [-ductW / 2, ductW / 2]) block(g, xx, top + 0.019, trayZ, 0.003, 0.039, 0.042, ductGrey);
  if (closed) {
    const bankX = 0.26 * w;
    const bank = hardware('ValveBank', bankX, top + 0.046, trayZ);
    g.add(bank);
    for (let i = 0; i < 5; i++) {
      const x = bankX + (i - 2) * 0.022;
      hose(
        g,
        [
          [x, top + 0.064, trayZ + 0.026],
          [x, top + 0.064, trayZ + 0.045],
          [x + 0.006, top + 0.016, trayZ + 0.054],
          [x + 0.045, top + 0.006, trayZ + 0.051],
          [x + 0.09, top + 0.008, trayZ + 0.017],
        ],
        0.0023,
        i % 2 ? rubber : finish.pipe,
      );
    }
  }
  if (guardWidth) guard(g, 0, side + 0.01, guardWidth, 0.48);
  if (hmi) consolePanel(g, -w * 0.35, side + 0.025);
  batch(g);
  root.add(g);
}

export function buildBases(cfg: LineConfig): THREE.Group {
  const group = new THREE.Group();
  // Each bench ends at its cell boundary. Inner deck edge also carries the
  // side-facing vision reader, while the return arcs have independent frames.
  for (const c of cells) {
    // Meet the next bench in the same row halfway across the gap between their frames.
    const row = cells.filter((o) => o !== c && Math.sign(o.z) === Math.sign(c.z));
    const gap = (dir: number) => {
      const edge = c.x + (dir * c.w) / 2;
      const next = row.map((o) => o.x - (dir * o.w) / 2).filter((e) => (e - edge) * dir >= 0 && Math.abs(e - edge) < 0.02);
      return next.length ? Math.abs(next[0] - edge) / 2 : 0;
    };
    bench(group, c.x, c.z, c.w, c.d, c.id, c.name, c.closed, c.guard, c.hmi, [gap(-1), gap(1)]);
  }
  for (const dir of [-1, 1]) {
    const g = new THREE.Group();
    const x = dir * (cfg.track.straight / 2 + cfg.track.radius - 0.09);
    profile(g, [x, 0.095, -0.22], [x, 0.79, -0.22], 0.045);
    profile(g, [x, 0.095, 0.22], [x, 0.79, 0.22], 0.045);
    profile(g, [x, 0.79, -0.27], [x, 0.79, 0.27], 0.05);
    for (const z of [-0.22, 0.22]) levelFoot(g, x, z);
    const motor = hardware('Gearmotor', x, 0.76, 0);
    motor.rotation.y = (dir * Math.PI) / 2;
    g.add(motor);
    block(g, x, 0.815, 0, 0.14, 0.07, 0.13, enameled);
    batch(g);
    group.add(g);
  }
  applyContactMap(group, topFinish, 'deck');
  return group;
}
