import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { cells } from './cells';
import { BELT_Y, TABLE, mat } from './build';
import { batch, block, finish, gland, hardware, hose, plate, profile, round, warning } from './hardware';
import { applyContactMap } from './occlusion';
import { brushedFinish, brushedUv } from './textures';
import { contactPatch } from './hall';

// Brushed stainless deck plates: their look is the room they reflect. A shade darker than the
// carriers and cabinets, so those stand out on it.
const deck = mat(0x8e9496, { roughness: 1, map: brushedFinish().map, roughnessMap: brushedFinish().rough, metalness: 1 });
const topFinish = deck.clone();
const rubber = finish.seal;
const dark = finish.graphite;
const enameled = finish.powder;
const trim = finish.zinc;
const amber = mat(0xe5b542);
const red = mat(0xac312b, { roughness: 0.38 });
/** Corrugated board cartons with tape and a label, and a grey (non-reject) tote. */
const carton = mat(0xa88a62, { roughness: 0.9 });
const tape = mat(0xc4a777, { roughness: 0.4 });
const cartonLabel = mat(0xeeeee6, { roughness: 0.6 });
const spareTote = mat(0x5d6a70, { roughness: 0.55 });
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

/** Operator touchscreen: line mimic with station states, output figures, alarm banner, softkeys. */
function screen(): THREE.Material {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 576;
  const p = c.getContext('2d')!;
  p.fillStyle = '#1b2427';
  p.fillRect(0, 0, 1024, 576);
  // Header bar.
  p.fillStyle = '#2b3a3f';
  p.fillRect(0, 0, 1024, 58);
  p.fillStyle = '#e8efec';
  p.font = 'bold 30px Arial';
  p.fillText('L07  PEN ASSEMBLY', 22, 39);
  p.font = '22px Arial';
  p.fillText('AUTO', 520, 38);
  p.fillStyle = '#3ccf72';
  p.beginPath();
  p.arc(500, 31, 9, 0, Math.PI * 2);
  p.fill();
  p.fillStyle = '#b8c6c2';
  p.fillText('Operator   14:32:07', 790, 38);
  // Line mimic: the loop with station boxes in their states.
  p.strokeStyle = '#7f9a97';
  p.lineWidth = 6;
  p.beginPath();
  p.roundRect(40, 92, 600, 200, 100);
  p.stroke();
  const states = ['#3ccf72', '#3ccf72', '#e6c34a', '#3ccf72', '#3ccf72', '#3ccf72', '#3ccf72', '#5fa8e8', '#3ccf72', '#3ccf72'];
  states.forEach((col, i) => {
    const top = i < 5;
    const x = 120 + (i % 5) * 110;
    const y = top ? 74 : 274;
    p.fillStyle = '#26363a';
    p.fillRect(x - 32, y, 64, 36);
    p.fillStyle = col;
    p.fillRect(x - 32, y + 30, 64, 6);
    p.fillStyle = '#dce6e3';
    p.font = 'bold 17px Arial';
    p.fillText(['EM11', 'EM12', 'EM13', 'EM14', 'EM15', 'EM60', 'EM50', 'EM41', 'EM40', 'EM32'][i], x - 24, y + 23);
  });
  // Figures.
  p.font = '20px Arial';
  p.fillStyle = '#9fb3ae';
  [
    ['OUTPUT / h', '1 184'],
    ['GOOD', '96.1 %'],
    ['OEE', '82.4 %'],
    ['BATCH', 'B261114'],
  ].forEach(([k, v], i) => {
    p.fillStyle = '#26363a';
    p.fillRect(680, 80 + i * 56, 316, 48);
    p.fillStyle = '#9fb3ae';
    p.fillText(k, 694, 111 + i * 56);
    p.fillStyle = '#eef4f1';
    p.font = 'bold 24px Arial';
    p.fillText(v, 860, 112 + i * 56);
    p.font = '20px Arial';
  });
  // Trend.
  p.strokeStyle = '#3e5157';
  p.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    p.beginPath();
    p.moveTo(40, 336 + i * 30);
    p.lineTo(640, 336 + i * 30);
    p.stroke();
  }
  p.strokeStyle = '#5fc0d8';
  p.lineWidth = 3;
  p.beginPath();
  for (let x = 0; x <= 600; x += 12) p.lineTo(40 + x, 400 - Math.sin(x * 0.03) * 14 - Math.sin(x * 0.11) * 6);
  p.stroke();
  // Alarm banner and softkeys.
  p.fillStyle = '#5a4a1c';
  p.fillRect(680, 312, 316, 52);
  p.fillStyle = '#f2d36b';
  p.font = 'bold 19px Arial';
  p.fillText('W 2031  EM13 feeder low', 694, 344);
  ['START', 'STOP', 'RESET', 'JOG', 'MENU'].forEach((k, i) => {
    p.fillStyle = i === 1 ? '#7a2b25' : i === 0 ? '#245c3a' : '#33474c';
    p.fillRect(30 + i * 198, 496, 180, 62);
    p.fillStyle = '#eef4f1';
    p.font = 'bold 24px Arial';
    p.fillText(k, 62 + i * 198, 536);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return mat(0x000000, { map: tex, roughness: 0.12, metalness: 0, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.9 });
}

function consolePanel(g: THREE.Group, x: number, z: number): void {
  profile(g, [x - 0.12, top, z - 0.1], [x - 0.12, 1.15, z - 0.1], 0.037);
  block(g, x - 0.04, 1.15, z - 0.1, 0.18, 0.037, 0.038, dark);
  round(g, x, 1.15, z - 0.057, 0.024, 0.08, dark).rotation.x = Math.PI / 2;
  block(g, x, 1.16, z - 0.012, 0.29, 0.196, 0.03, dark);
  block(g, x, 1.16, z + 0.0055, 0.3, 0.206, 0.005, trim);
  block(g, x - 0.012, 1.17, z + 0.0085, 0.258, 0.148, 0.002, rubber);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.248, 0.14), screen());
  panel.position.set(x - 0.012, 1.17, z + 0.0097);
  g.add(panel);
  for (const [dx, color, r] of [
    [0.098, red, 0.016],
    [-0.087, dark, 0.008],
    [-0.052, finish.pipe, 0.008],
  ] as const) {
    round(g, x + dx, 1.077, z + 0.011, r * 1.35, 0.006, dx > 0 ? amber : trim).rotation.x = Math.PI / 2;
    round(g, x + dx, 1.077, z + 0.021, r, 0.016, color).rotation.x = Math.PI / 2;
  }
  plate(g, x + 0.057, 1.195, z - 0.0275, 0.078, 0.025, 'HMI 07', '24 VDC', '#276c6e', Math.PI);
  round(g, x, 1.12, z - 0.031, 0.009, 0.012, trim, 12).rotation.x = Math.PI / 2;
  hose(
    g,
    [
      [x, 1.12, z - 0.036],
      [x, 1.04, z - 0.064],
      [x - 0.12, 1.055, z - 0.12],
      [x - 0.12, top, z - 0.12],
    ],
    0.006,
    finish.seal,
    false,
  );
  gland(g, x - 0.12, top, z - 0.12, 0.006);
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
  /** Whether the operator-edge duct runs on into the next bench toward -x and +x (world). */
  ductOn: [boolean, boolean] = [false, false],
): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  if (z < 0) g.rotation.y = Math.PI;
  const end = w / 2 - 0.074,
    side = d / 2 - 0.064;
  // Tops of neighbouring benches butt together (the group is turned for z < 0).
  const [left, right] = z < 0 ? [reach[1], reach[0]] : reach;
  brushedUv(block(g, (right - left) / 2, top - 0.013, 0, w + left + right, 0.026, d, topFinish), w + left + right, d);
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
    brushedUv(block(g, 0, 0.225, 0, w - 0.17, 0.02, d - 0.15, deck), w - 0.17, d - 0.15);
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
    // Stock on the lower shelf: taped cartons of empty trays, and a spare tote.
    const shelf = 0.235;
    const n = Math.max(1, Math.floor((w - 0.5) / 0.36));
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + 0.2 + i * 0.36;
      const stack = 1 + ((i + Math.round(w * 10)) % 2);
      for (let k = 0; k < stack; k++) {
        const y = shelf + 0.07 + k * 0.141;
        block(g, cx + k * 0.008, y, 0.13, 0.3, 0.14, 0.4, carton);
        block(g, cx + k * 0.008, y + 0.0702, 0.13, 0.3, 0.0012, 0.05, tape);
        block(g, cx + k * 0.008 - 0.08, y + 0.03, 0.3302, 0.09, 0.05, 0.0012, cartonLabel);
      }
    }
    const tote = hardware('Tote', w / 2 - 0.2, shelf, 0.02);
    tote.scale.set(1, 0.85, 1);
    tote.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = spareTote;
    });
    g.add(tote);
  }
  // Slotted PVC wiring duct along the operator edge: fingers on both sides and a clip-on lid.
  // Where the next bench's duct lines up it runs on into it; a free end has an end cap and the
  // cables drop through a grommeted cut-out in the deck there.
  const trayZ = side - 0.044;
  const [onL, onR] = z < 0 ? [ductOn[1], ductOn[0]] : ductOn;
  const d0 = onL ? -w / 2 - left : -w / 2 + 0.075;
  const d1 = onR ? w / 2 + right : w / 2 - 0.075;
  const ductW = d1 - d0;
  const dc = (d0 + d1) / 2;
  block(g, dc, top + 0.0015, trayZ, ductW, 0.003, 0.04, ductGrey);
  for (const dz of [-0.0185, 0.0185]) {
    block(g, dc, top + 0.006, trayZ + dz, ductW, 0.006, 0.003, ductGrey);
    for (let xx = d0 + 0.006; xx < d1 - 0.004; xx += 0.012) block(g, xx, top + 0.022, trayZ + dz, 0.0075, 0.026, 0.003, ductGrey);
  }
  block(g, dc, top + 0.037, trayZ, ductW + (onL ? 0 : 0.001) + (onR ? 0 : 0.001), 0.004, 0.044, ductGrey);
  block(g, dc, top + 0.0396, trayZ, ductW - (onL ? 0 : 0.005) - (onR ? 0 : 0.005), 0.0012, 0.03, ductLid);
  for (const [xx, on, dir] of [
    [d0, onL, -1],
    [d1, onR, 1],
  ] as const) {
    if (on) continue;
    block(g, xx, top + 0.019, trayZ, 0.003, 0.039, 0.042, ductGrey);
    // Cut-out with a rubber edge just past the end; the cable bundle bends down into it.
    block(g, xx + dir * 0.03, top + 0.0007, trayZ, 0.044, 0.0014, 0.05, rubber);
    block(g, xx + dir * 0.03, top + 0.0009, trayZ, 0.034, 0.0014, 0.04, dark);
    for (let k = 0; k < 3; k++)
      hose(
        g,
        [
          [xx - dir * 0.012, top + 0.012, trayZ - 0.008 + k * 0.008],
          [xx + dir * 0.012, top + 0.009, trayZ - 0.008 + k * 0.008],
          [xx + dir * 0.026, top - 0.002, trayZ - 0.008 + k * 0.008],
          [xx + dir * 0.03, top - 0.02, trayZ - 0.008 + k * 0.008],
        ],
        0.0028,
        k === 1 ? finish.pipe : rubber,
        false,
      );
  }
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
    // The operator-edge ducts of neighbouring benches line up when their front edges do.
    const front = (o: (typeof cells)[number]) => o.z + (Math.sign(o.z) * o.d) / 2;
    const lined = (dir: number) =>
      gap(dir) > 0 && row.some((o) => Math.abs(o.x - (dir * o.w) / 2 - (c.x + (dir * c.w) / 2)) < 0.4 && Math.abs(front(o) - front(c)) < 0.005);
    bench(group, c.x, c.z, c.w, c.d, c.id, c.name, c.closed, c.guard, c.hmi, [gap(-1), gap(1)], [lined(-1), lined(1)]);
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
  // Infill between the two rows of benches inside the loop: a bolted cover plate at deck height,
  // so the loop stands on one continuous machine base.
  const inner = cells.filter((c) => c.z < 0).map((c) => c.z + c.d / 2);
  const outer = cells.filter((c) => c.z > 0).map((c) => c.z - c.d / 2);
  const z0 = Math.max(...inner);
  const z1 = Math.min(...outer);
  const x0 = Math.max(Math.min(...cells.filter((c) => c.z < 0).map((c) => c.x - c.w / 2)), Math.min(...cells.filter((c) => c.z > 0).map((c) => c.x - c.w / 2)));
  const x1 = Math.min(Math.max(...cells.filter((c) => c.z < 0).map((c) => c.x + c.w / 2)), Math.max(...cells.filter((c) => c.z > 0).map((c) => c.x + c.w / 2)));
  const infill = new THREE.Group();
  const panels = Math.round((x1 - x0) / 0.9);
  for (let i = 0; i < panels; i++) {
    const pw = (x1 - x0) / panels;
    const cx = x0 + (i + 0.5) * pw;
    brushedUv(block(infill, cx, top - 0.004, (z0 + z1) / 2, pw - 0.003, 0.008, z1 - z0 - 0.002, topFinish), pw - 0.003, z1 - z0 - 0.002);
    for (const dx of [-pw / 2 + 0.03, pw / 2 - 0.03]) for (const dz of [z0 + 0.025, z1 - 0.025]) round(infill, cx + dx, top + 0.0004, dz, 0.0042, 0.0008, trim, 12);
  }
  block(infill, (x0 + x1) / 2, top - 0.03, (z0 + z1) / 2, x1 - x0, 0.04, 0.03, dark);
  batch(infill);
  group.add(infill);
  // Services on the tray outfeed bench: the line's air service unit and a terminal box,
  // with their air line and cable dropping into the operator-side duct.
  const services = new THREE.Group();
  const air = hardware('AirPrep', -2.32, top, 0.6);
  services.add(air);
  contactPatch(services, -2.32, top + 0.0009, 0.59, 0.3, 0.12);
  hose(
    services,
    [
      [-2.204, top + 0.142, 0.589],
      [-2.17, top + 0.13, 0.62],
      [-2.18, top + 0.03, 0.8],
      [-2.2, top + 0.012, 1.0],
      [-2.22, top + 0.02, 1.16],
    ],
    0.0042,
    finish.pipe,
  );
  const box = hardware('JunctionBox', -1.98, top + 0.012, 0.63);
  services.add(box);
  block(services, -1.98, top + 0.006, 0.63, 0.28, 0.012, 0.11, dark);
  contactPatch(services, -1.98, top + 0.0009, 0.63, 0.36, 0.17);
  for (let i = 0; i < 3; i++)
    hose(
      services,
      [
        [-2.04 + i * 0.042, top + 0.006, 0.63],
        [-2.04 + i * 0.042, top + 0.004, 0.7],
        [-2.06 + i * 0.03, top + 0.006, 0.95],
        [-2.08 + i * 0.02, top + 0.02, 1.16],
      ],
      0.0035,
    );
  batch(services);
  group.add(services);
  applyContactMap(group, topFinish, 'deck');
  return group;
}
