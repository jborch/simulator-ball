// A panel-built production room with flush observation glazing onto a second
// service gallery. The shell cuts away as the operator orbits outside it.
import * as THREE from 'three';
import { applyContactMap } from './occlusion';
import { backdrop } from './contact';
import { mat } from './build';
import { clearMaterial } from './clear';
import { batch, block, plate, round } from './hardware';

function canvasMap(size: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Cleanroom wall panels: off-white sandwich panels with a vertical joint at each edge and in the
// middle of a bay, a horizontal joint, and a faint wash that darkens toward the floor.
const wallMap = canvasMap(512, (c) => {
  const wash = c.createLinearGradient(0, 0, 0, 512);
  wash.addColorStop(0, '#f1f0ea');
  wash.addColorStop(0.6, '#e4e3dc');
  wash.addColorStop(1, '#cfd0ca');
  c.fillStyle = wash;
  c.fillRect(0, 0, 512, 512);
  c.fillStyle = 'rgba(70,76,76,.42)';
  for (const x of [0, 255, 509]) c.fillRect(x, 0, 3, 512);
  c.fillRect(0, 168, 512, 2);
  c.fillStyle = 'rgba(255,255,255,.55)';
  for (const x of [3, 258]) c.fillRect(x, 0, 1, 512);
});
// The hall's own surfaces take less of the key than the machine (HALL), and the gallery behind
// the glass less again (GALLERY): a dimmer room seen through a window.
const hall = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => backdrop(mat(color, extra), 0.3, 0.88);
const gallery = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => backdrop(mat(color, extra), 0.18, 0.56);
const wall = hall(0x959893, { map: wallMap, roughness: 0.5, metalness: 0 });
const trim = hall(0xaab1b1, { roughness: 0.32, metalness: 0.9 });
const dark = hall(0x3d4446, { roughness: 0.5, metalness: 0 });
const door = hall(0x7f97a2, { roughness: 0.4, metalness: 0 });
const beacon = mat(0xfff5dd, { emissive: 0xfff6e2, emissiveIntensity: 2.5 });
const galleryGlass = clearMaterial({ color: 0xd8e4e6, edge: 0x9fb2b6, opacity: [0.06, 0.3], roughness: 0.04, power: 3, envMapIntensity: 1.2 });
const sill = hall(0x6f7c80, { roughness: 0.45, metalness: 0 });
const galleryWall = gallery(0x737b79, { roughness: 0.6, metalness: 0 });
const galleryTrim = gallery(0xaab1b1, { roughness: 0.32, metalness: 0.9 });
const galleryDark = gallery(0x30373a, { roughness: 0.5, metalness: 0 });
const cabinet = gallery(0xbfc4c1, { roughness: 0.42, metalness: 0 });
const stainless = gallery(0xbcc2c4, { roughness: 0.22, metalness: 1 });
/** Brushed bands and girth welds on the tanks. */
const weld = gallery(0x9ea4a6, { roughness: 0.42, metalness: 1 });
const sightGlass = gallery(0x9fb0b4, { roughness: 0.1, metalness: 0.2 });
const valveBlue = gallery(0x34557a, { roughness: 0.45, metalness: 0.1 });
const amber = hall(0xb49856, { metalness: 0.66, roughness: 0.4 });
const safetyRed = hall(0xa83a2e, { roughness: 0.38, metalness: 0 });

function floor(): THREE.Mesh {
  // Mid-grey epoxy resin: a fine speckle and a faint cloud in the colour, saw-cut joints with
  // slightly worn edges. One repeat = 2.8 m (a joint at every edge). The gloss map is a soft
  // cloud too (no strokes), so the strips' reflections spread evenly instead of streaking.
  const lcg = (s: number) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const tex = canvasMap(1024, (c) => {
    const img = c.createImageData(1024, 1024);
    const rnd = lcg(17);
    for (let y = 0; y < 1024; y++)
      for (let x = 0; x < 1024; x++) {
        const fleck = rnd();
        const grain = (rnd() - 0.5) * 5 + (fleck > 0.985 ? 9 : fleck < 0.012 ? -8 : 0);
        const u = (x / 1024) * Math.PI * 2;
        const v = (y / 1024) * Math.PI * 2;
        const cloud = 2.2 * Math.sin(u * 2 + Math.sin(v * 3) * 1.3) * Math.sin(v * 2 + Math.sin(u * 1) * 1.7) + 1.2 * Math.sin(u * 5 + v * 3);
        const k = 82 + grain + cloud;
        img.data.set([k, k + 2, k + 2, 255], 4 * (x + y * 1024));
      }
    c.putImageData(img, 0, 0);
    c.fillStyle = 'rgba(28,32,32,.75)';
    c.fillRect(0, 0, 2.5, 1024);
    c.fillRect(0, 0, 1024, 2.5);
    c.fillStyle = 'rgba(150,156,152,.35)';
    c.fillRect(2.5, 0, 1.5, 1024);
    c.fillRect(0, 2.5, 1024, 1.5);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  const gloss = canvasMap(256, (c) => {
    const img = c.createImageData(256, 256);
    const rnd = lcg(91);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const u = (x / 256) * Math.PI * 2;
        const v = (y / 256) * Math.PI * 2;
        const cloud = Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * Math.sin(v * 2 + Math.sin(u * 3) * 1.1);
        const k = 92 + cloud * 14 + (rnd() - 0.5) * 6;
        img.data.set([k, k, k, 255], 4 * (x + y * 256));
      }
    c.putImageData(img, 0, 0);
  });
  gloss.colorSpace = THREE.NoColorSpace;
  gloss.wrapS = gloss.wrapT = THREE.RepeatWrapping;
  gloss.repeat.set(5, 5);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(33.6, 33.6), mat(0xffffff, { map: tex, roughness: 0.92, roughnessMap: gloss, metalness: 0 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  applyContactMap(mesh, mesh.material, 'floor');
  return mesh;
}

/** Broad, baked penumbra at floor/deck contacts. */
const contact = canvasMap(128, (c) => {
  const grad = c.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(27,37,33,.57)');
  grad.addColorStop(0.53, 'rgba(30,40,36,.32)');
  grad.addColorStop(1, 'rgba(30,40,36,0)');
  c.fillStyle = grad;
  c.fillRect(0, 0, 128, 128);
});
const contactMat = new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
export function contactPatch(g: THREE.Object3D, x: number, y: number, z: number, w: number, d: number): void {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), contactMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
}

const galleryFloor = gallery(0x6f7573, { roughness: 0.45, metalness: 0 });
const galv = hall(0xa9b0b0, { roughness: 0.42, metalness: 0.9 });
const cable = hall(0x232829, { roughness: 0.6, metalness: 0 });
const sprinkler = hall(0x9c2d24, { roughness: 0.4, metalness: 0 });
const brassHead = hall(0xb79a5a, { roughness: 0.3, metalness: 1 });
const conduit = hall(0x8e9493, { roughness: 0.5, metalness: 0 });
const outletFace = hall(0x4d5a8a, { roughness: 0.5, metalness: 0 });

/** Wall clock: white dial, black hands and ticks, aluminium bezel. Faces +z. */
function clock(g: THREE.Group, x: number, y: number, z: number): void {
  const face = canvasMap(256, (c) => {
    c.fillStyle = '#f4f4f0';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#1b1f20';
    c.translate(128, 128);
    for (let i = 0; i < 60; i++) {
      c.lineWidth = i % 5 ? 2 : 6;
      c.beginPath();
      c.moveTo(0, -118);
      c.lineTo(0, i % 5 ? -108 : -96);
      c.stroke();
      c.rotate(Math.PI / 30);
    }
    c.lineCap = 'round';
    for (const [ang, len, w] of [
      [-0.9, 62, 9],
      [2.2, 92, 6],
    ] as const) {
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.sin(ang) * len, -Math.cos(ang) * len);
      c.stroke();
    }
  });
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.15, 48), mat(0xffffff, { map: face, roughness: 0.3 }));
  dial.position.set(x, y, z + 0.0168);
  g.add(dial);
  const rim = round(g, x, y, z + 0.004, 0.163, 0.024, trim, 48);
  rim.rotation.x = Math.PI / 2;
}

/** Lit emergency exit sign (running figure, door and arrow) over a door. Faces +z. */
let exitMat: THREE.MeshStandardMaterial;
function exitSign(g: THREE.Group, x: number, y: number, z: number, show: boolean): void {
  // Only over the end doors of the long walls, outside the station cameras' views.
  if (!show) return;
  exitMat ??= mat(0xffffff, {
    map: canvasMap(256, (c) => {
      c.fillStyle = '#138a4c';
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#f4fff8';
      c.fillRect(150, 40, 70, 176);
      c.fillStyle = '#138a4c';
      c.fillRect(160, 50, 50, 166);
      c.fillStyle = '#f4fff8';
      c.beginPath();
      c.arc(108, 62, 16, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = 16;
      c.lineCap = 'round';
      c.strokeStyle = '#f4fff8';
      for (const [a, b, d, e] of [
        [104, 84, 92, 140],
        [92, 140, 122, 178],
        [92, 140, 66, 186],
        [104, 92, 132, 112],
        [104, 92, 70, 104],
      ])
        c.beginPath(), c.moveTo(a, b), c.lineTo(d, e), c.stroke();
    }),
    emissive: 0x2bd47a,
    emissiveIntensity: 0.35,
    roughness: 0.3,
  });
  block(g, x, y, z, 0.42, 0.21, 0.03, trim);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.19), exitMat);
  face.scale.x = 2;
  face.position.set(x, y, z + 0.016);
  g.add(face);
}

function wallRun(length: number, gallery: boolean, bayName: string): THREE.Group {
  const g = new THREE.Group();
  const longWall = bayName.startsWith('AIRLOCK');
  const n = Math.round(length / 2);
  const pitch = length / n;
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (i + 0.5) * pitch;
    const glazed = gallery && i % 4 !== 0 && i % 5 !== 3;
    if (glazed) {
      block(g, x, 0.48, 0, pitch - 0.012, 0.96, 0.12, sill);
      block(g, x, 3.53, 0, pitch - 0.012, 1.94, 0.12, wall);
      block(g, x, 1.76, -0.005, pitch - 0.02, 1.59, 0.011, galleryGlass);
      for (const h of [0.98, 2.54]) block(g, x, h, 0, pitch, 0.055, 0.15, trim);
      block(g, x - pitch / 2 + 0.02, 1.76, 0, 0.054, 1.56, 0.13, trim);
      // Secondary room seen through the glass, with pilasters, conduits,
      // instrument cupboards and lights at genuine depth behind the window.
      block(g, x, 2.1, -2.0, pitch + 0.01, 4.2, 0.12, galleryWall);
      block(g, x - 0.72, 1.9, -1.85, 0.08, 3.8, 0.1, cabinet);
      for (const h of [2.36, 2.45]) block(g, x, h, -1.65, pitch, 0.042, 0.055, galleryTrim);
      if (i % 3 === 2) {
        // Two jacketed stainless vessels on legs: dished heads, girth welds, a manway and vent
        // on top, a level sight glass, and an outlet with a valve at the bottom.
        for (const dx of [-0.48, 0.27]) {
          const cx = x + dx;
          const cz = -1.36;
          round(g, cx, 1.0, cz, 0.256, 1.3, stainless, 40);
          for (const [y, sy] of [
            [1.65, 0.36],
            [0.35, -0.3],
          ]) {
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.256, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2), stainless);
            head.position.set(cx, y, cz);
            head.scale.y = sy;
            g.add(head);
          }
          for (const y of [0.352, 0.79, 1.22, 1.648]) round(g, cx, y, cz, 0.2585, 0.006, weld, 40);
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + 0.5;
            const lx = cx + Math.cos(a) * 0.205;
            const lz = cz + Math.sin(a) * 0.205;
            round(g, lx, 0.25, lz, 0.022, 0.37, stainless, 12);
            round(g, lx, 0.072, lz, 0.04, 0.014, weld, 16);
          }
          round(g, cx - 0.06, 1.77, cz, 0.085, 0.07, stainless, 24);
          round(g, cx - 0.06, 1.81, cz, 0.095, 0.018, weld, 24);
          round(g, cx + 0.1, 1.86, cz, 0.028, 0.3, stainless, 12);
          round(g, cx + 0.1, 2.02, cz, 0.045, 0.025, galleryDark, 16);
          // Sight glass on two stand-offs, toward the window.
          round(g, cx + 0.16, 1.0, cz + 0.22, 0.009, 0.92, sightGlass, 10);
          for (const y of [0.55, 1.45]) block(g, cx + 0.15, y, cz + 0.2, 0.03, 0.02, 0.05, weld);
          // Bottom outlet: pipe out toward the glass, a butterfly valve with its blue actuator.
          const out = round(g, cx, 0.24, cz + 0.2, 0.024, 0.22, stainless, 12);
          out.rotation.x = Math.PI / 2;
          round(g, cx, 0.24, cz + 0.33, 0.04, 0.03, weld, 16).rotation.x = Math.PI / 2;
          block(g, cx, 0.31, cz + 0.33, 0.05, 0.09, 0.05, valveBlue);
          plate(g, cx - 0.12, 1.1, cz + 0.251, 0.12, 0.04, dx < 0 ? 'T-201' : 'T-202', 'WFI  250 L');
        }
      } else {
        // Air handling cabinet: double door on a plinth, louvres, a lock, a lamp and cable tray.
        const cx = x + 0.3;
        block(g, cx, 0.95, -1.43, 0.82, 1.74, 0.48, cabinet);
        block(g, cx, 0.05, -1.41, 0.8, 0.1, 0.46, galleryDark);
        block(g, cx, 1.86, -1.43, 0.84, 0.06, 0.5, cabinet);
        block(g, cx - 0.01, 0.95, -1.188, 0.006, 1.66, 0.006, galleryDark);
        for (const sx of [-1, 1]) {
          block(g, cx + sx * 0.4, 0.95, -1.188, 0.006, 1.66, 0.006, galleryDark);
          block(g, cx - 0.01 + sx * 0.035, 1.05, -1.177, 0.016, 0.15, 0.022, galleryDark);
        }
        for (let j = 0; j < 8; j++) block(g, cx - 0.21, 0.3 + j * 0.03, -1.184, 0.25, 0.012, 0.012, galleryTrim);
        for (let j = 0; j < 6; j++) block(g, cx - 0.21, 1.53 + j * 0.031, -1.184, 0.25, 0.013, 0.015, galleryTrim);
        plate(g, cx + 0.19, 1.52, -1.184, 0.18, 0.057, 'AHU', 'AIR HANDLING');
        round(g, cx + 0.3, 1.92, -1.3, 0.03, 0.05, galleryDark, 12);
        block(g, cx, 2.0, -1.55, 0.7, 0.04, 0.2, galleryTrim);
      }
      block(g, x, 2.82, -1.19, 1.32, 0.065, 0.11, beacon);
    } else {
      block(g, x, 2.25, 0, pitch - 0.012, 4.5, 0.12, wall);
      block(g, x, 0.48, 0.063, pitch - 0.012, 0.96, 0.014, sill);
      if (i % 3 !== 0) {
        // Text signs only on the end walls: the station cameras look at the long walls past
        // their own posts, where a sign would show in pieces. The long walls get a clock.
        // High on the wall, under the grille: the low close-ups along the line see the wall below
        // it, not a sign cut by their frame.
        if (!longWall) plate(g, x, 2.33, 0.066, 1.29, 0.36, 'UTILITY  /  03', 'PEN ASSEMBLY   •   CONTROLLED AREA');
        else if (i % 4 === 0) clock(g, x, 2.24, 0.075);
        block(g, x, 2.9, 0.075, 1.17, 0.52, 0.031, trim);
        for (let j = 0; j < 12; j++) block(g, x, 2.68 + j * 0.039, 0.1, 1.1, 0.012, 0.03, dark);
      }
      if (i % 3 === 0) {
        block(g, x, 1.13, 0.084, 1.32, 2.26, 0.075, dark);
        for (const sign of [-1, 1]) {
          const dx = x + sign * 0.319;
          block(g, dx, 1.113, 0.13, 0.627, 2.214, 0.038, door);
          block(g, dx, 1.54, 0.15, 0.432, 0.585, 0.012, dark);
          block(g, dx, 1.54, 0.157, 0.393, 0.547, 0.008, matGlass);
          block(g, dx, 0.97, 0.173, 0.35, 0.024, 0.028, trim);
          block(g, dx, 0.21, 0.153, 0.616, 0.32, 0.006, trim);
        }
        if (!longWall) plate(g, x, 2.46, 0.067, 0.74, 0.19, bayName, 'CONTROLLED ACCESS');
        else exitSign(g, x, 2.42, 0.07, i === 0);
        block(g, x + 0.78, 1.28, 0.112, 0.122, 0.18, 0.085, dark);
        block(g, x + 0.78, 1.32, 0.16, 0.075, 0.038, 0.018, door);
        round(g, x - 0.81, 0.65, 0.173, 0.076, 0.43, safetyRed);
        round(g, x - 0.81, 0.89, 0.173, 0.031, 0.055, amber);
        block(g, x - 0.795, 0.93, 0.173, 0.093, 0.021, 0.045, safetyRed);
        plate(g, x - 0.81, 0.67, 0.25, 0.091, 0.108, 'CO₂', 'FIRE');
      }
    }
    block(g, x, 0.14, 0.066, pitch, 0.24, 0.035, trim);
    block(g, x, 0.76, 0.086, pitch, 0.092, 0.052, dark);
    if (i % 3 === 1) {
      block(g, x - 0.7, 2.23, 0.1, 0.13, 4.46, 0.18, trim);
      plate(g, x - 0.71, 1.79, 0.198, 0.115, 0.045, 'B' + (i + 1), 'COLUMN');
    }
  }
  // Services along the wall at high level: a galvanised cable ladder with cables on brackets,
  // the red sprinkler main above it, and grey conduits dropping to outlet boxes.
  const L = length - 0.3;
  for (const z of [0.07, 0.29]) block(g, 0, 3.05, z, L, 0.06, 0.006, galv);
  for (let x = -L / 2; x <= L / 2; x += 0.3) block(g, x, 3.03, 0.18, 0.025, 0.012, 0.22, galv);
  for (let x = -L / 2 + 0.2; x < L / 2; x += 1.5) {
    block(g, x, 3.0, 0.18, 0.04, 0.008, 0.26, galv);
    block(g, x, 3.05, 0.065, 0.04, 0.12, 0.006, galv);
  }
  for (const [dz, dy, r] of [
    [0.11, 3.05, 0.011],
    [0.14, 3.05, 0.008],
    [0.165, 3.049, 0.012],
    [0.2, 3.048, 0.009],
    [0.23, 3.05, 0.01],
  ])
    round(g, 0, dy, dz, r, L, cable, 10).rotation.z = Math.PI / 2;
  round(g, 0, 3.72, 0.16, 0.045, length, sprinkler, 16).rotation.z = Math.PI / 2;
  for (let x = -length / 2 + 0.5; x < length / 2; x += 2) {
    block(g, x, 3.72, 0.08, 0.03, 0.12, 0.012, galv);
    round(g, x + 0.9, 3.67, 0.16, 0.012, 0.05, sprinkler, 10);
    round(g, x + 0.9, 3.635, 0.16, 0.018, 0.012, brassHead, 12);
  }
  for (let i = 0; i < n; i++) {
    // On solid bays only (not in front of the gallery glazing), clear of the signs, clocks and
    // grilles; at a door the conduit feeds the card reader.
    if (gallery && i % 4 !== 0 && i % 5 !== 3) continue;
    const x = -length / 2 + (i + 0.5) * pitch + 0.78;
    if (i % 3 === 0) {
      round(g, x, 2.215, 0.09, 0.012, 1.67, conduit, 10);
      continue;
    }
    round(g, x, 2.13, 0.09, 0.012, 1.84, conduit, 10);
    block(g, x, 1.18, 0.09, 0.09, 0.12, 0.05, conduit);
    block(g, x, 1.18, 0.116, 0.07, 0.07, 0.003, outletFace);
  }
  block(g, 0, 2.2, -2.15, length + 4, 4.5, 0.12, galleryWall);
  block(g, 0, 0.035, -1.12, length + 4, 0.06, 2.25, galleryFloor);
  block(g, 0, 3.18, -1.12, length + 4, 0.09, 2.25, galleryWall);
  batch(g);
  for (const o of g.children) o.castShadow = false;
  return g;
}
const matGlass = hall(0x3f5357, { metalness: 0.2, roughness: 0.08 });

export class Hall {
  private readonly cuts: { g: THREE.Group; normal: THREE.Vector3; limit: number }[] = [];
  constructor(scene: THREE.Scene) {
    scene.add(floor());
    const marks = new THREE.Group();
    const yellow = mat(0xc7ab59, { roughness: 0.64 });
    for (const z of [-2.03, 2.03]) block(marks, 0, 0.001, z, 7.34, 0.001, 0.048, yellow);
    for (const x of [-3.67, 3.67]) block(marks, x, 0.001, 0, 0.048, 0.001, 4.1, yellow);
    // Floor identification, printed flush inside the pedestrian boundary.
    const stencil = canvasMap(512, (c) => {
      c.fillStyle = 'rgba(235,225,186,.81)';
      c.font = 'bold 96px Arial';
      c.fillText('L07', 8, 200);
      c.fillRect(8, 217, 465, 6);
      c.font = 'bold 42px Arial';
      c.fillText('ASSEMBLY', 8, 279);
    });
    const lettering = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({ map: stencil, transparent: true, depthWrite: false }),
    );
    lettering.rotation.x = -Math.PI / 2;
    lettering.position.set(-2.72, 0.0036, 1.75);
    marks.add(lettering);
    batch(marks);
    scene.add(marks);
    for (const [x, z, angle, len, name] of [
      [0, -6.6, 0, 18, 'AIRLOCK 02'],
      [0, 6.6, Math.PI, 18, 'AIRLOCK 04'],
      [-9, 0, Math.PI / 2, 13.2, 'SERVICE 01'],
      [9, 0, -Math.PI / 2, 13.2, 'SERVICE 03'],
    ] as const) {
      const g = wallRun(len, true, name);
      g.rotation.y = angle;
      g.position.set(x, 0, z);
      scene.add(g);
      this.cuts.push({ g, normal: new THREE.Vector3(x, 0, z).normalize(), limit: Math.hypot(x, z) - 0.15 });
    }
    // Zone sign hung from the ceiling over the far aisle, high enough that the station
    // cameras (looking level across the belt) don't see it.
    const zone = new THREE.Group();
    block(zone, 0, 2.76, -1.7, 1.66, 0.46, 0.03, trim);
    for (const side of [1, -1]) {
      const sign = plate(zone, 0, 2.76, -1.7 + side * 0.0158, 1.62, 0.42, 'L07   PEN ASSEMBLY', 'CLEAN ZONE   •   ISO 8   •   GOWNING REQUIRED');
      if (side < 0) sign.rotation.y = Math.PI;
    }
    // Hung on two threaded rods from ceiling anchors, with clamp brackets on the sign frame
    // and a turnbuckle to level it.
    for (const dx of [-0.7, 0.7]) {
      round(zone, dx, 3.74, -1.7, 0.0045, 1.5, trim, 8);
      block(zone, dx, 4.48, -1.7, 0.09, 0.012, 0.09, dark);
      block(zone, dx, 3.01, -1.7, 0.035, 0.04, 0.05, dark);
      round(zone, dx, 3.32, -1.7, 0.009, 0.07, trim, 10);
    }
    batch(zone);
    scene.add(zone);
    this.cuts.push({ g: zone, normal: new THREE.Vector3(0, 1, 0), limit: 3.84 });
    const roof = new THREE.Group();
    block(roof, 0, 4.53, 0, 18, 0.09, 13.2, wall);
    for (let x = -8; x <= 8; x += 2) {
      block(roof, x, 4.32, 0, 0.1, 0.27, 13.2, trim);
      for (const z of [-4.2, 0, 4.2]) {
        block(roof, x, 3.99, z, 0.25, 0.09, 2.9, dark);
        block(roof, x, 3.94, z, 0.19, 0.012, 2.82, beacon);
        for (const dz of [-0.98, 0.98]) round(roof, x, 4.17, z + dz, 0.009, 0.3, trim, 8);
      }
    }
    for (const z of [-3.3, 3.3]) {
      const duct = round(roof, 0, 4.03, z, 0.18, 18, trim, 24);
      duct.rotation.z = Math.PI / 2;
      for (let x = -8; x <= 8; x += 1) round(roof, x, 4.03, z, 0.185, 0.027, dark, 24).rotation.z = Math.PI / 2;
    }
    batch(roof);
    for (const o of roof.children) o.castShadow = false;
    scene.add(roof);
    this.cuts.push({ g: roof, normal: new THREE.Vector3(0, 1, 0), limit: 3.84 });
  }

  cutaway(position: THREE.Vector3): void {
    for (const { g, normal, limit } of this.cuts) g.visible = position.dot(normal) < limit;
  }
}
