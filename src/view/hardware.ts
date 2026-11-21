// Reusable, metre-scale machine hardware. Keep moving assemblies in their own
// coordinate frames and batch only the rigid parts of a single assembly.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, mat } from './build';
import { clearMaterial } from './clear';

const kit = new Map<string, THREE.Object3D>();
const components = [
  'Profile40',
  'ColumnShoe',
  'Servo',
  'Cylinder',
  'JawBody',
  'PressStandard',
  'Tote',
  'Gearmotor',
  'GuideClip',
  'Stopper',
  'StopHead',
  'Finger',
  'VisionCamera',
  'AirPrep',
  'JunctionBox',
  'Vibrator',
  'Indexer',
  'ValveBank',
  'Smock',
  'Sleeve',
  'Trouser',
] as const;
export function installHardware(root: THREE.Object3D): void {
  for (const name of components) {
    const obj = root.getObjectByName(name);
    if (!obj) throw new Error(`Missing machine component ${name}`);
    kit.set(name, obj);
  }
  // Printed plates modelled as UV-mapped quads get their artwork here.
  const replace: Record<string, THREE.Material> = {
    'Motor nameplate': ratingPlate(),
    'Gauge face': gaugeFace(),
    'Filter bowl': clearMaterial({ color: 0xdfe7ea, edge: 0x7f9197, opacity: [0.25, 0.85], roughness: 0.1 }),
    'Reject polypropylene': moulded(0x9b3f37),
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && replace[mesh.material.name]) mesh.material = replace[mesh.material.name];
  });
}

/**
 * Moulded polypropylene (the reject totes): a muted signal red, satin, with the slightly uneven
 * gloss of an injection moulding (flow marks, a matt-textured band) in the roughness.
 */
function moulded(color: number): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const p = c.getContext('2d')!;
  const img = p.createImageData(128, 128);
  let seed = 4242;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const flow = Math.sin((x + y * 0.6) * 0.09 + Math.sin(y * 0.05) * 2) * 14;
      const k = 150 + flow + (rnd() - 0.5) * 30;
      img.data.set([k, k, k, 255], 4 * (x + y * 128));
    }
  p.putImageData(img, 0, 0);
  const rough = new THREE.CanvasTexture(c);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  return mat(color, { roughness: 1, roughnessMap: rough, metalness: 0, name: 'Reject polypropylene' });
}

/** Pressure gauge dial (0–10 bar, needle near 6), round on a transparent square. */
function gaugeFace(): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const p = c.getContext('2d')!;
  p.translate(64, 64);
  p.fillStyle = '#f2f2ee';
  p.beginPath();
  p.arc(0, 0, 62, 0, Math.PI * 2);
  p.fill();
  p.strokeStyle = '#1d2224';
  p.fillStyle = '#1d2224';
  p.font = 'bold 15px Arial';
  p.textAlign = 'center';
  p.textBaseline = 'middle';
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI * 1.25 + (i / 10) * Math.PI * 1.5;
    p.lineWidth = i % 5 ? 2 : 4;
    p.beginPath();
    p.moveTo(Math.cos(a) * 54, Math.sin(a) * 54);
    p.lineTo(Math.cos(a) * 44, Math.sin(a) * 44);
    p.stroke();
    if (i % 2 === 0) p.fillText(String(i), Math.cos(a) * 33, Math.sin(a) * 33);
  }
  p.strokeStyle = '#2f8f4e';
  p.lineWidth = 5;
  p.beginPath();
  p.arc(0, 0, 50, -Math.PI * 1.25 + 0.75 * Math.PI, -Math.PI * 1.25 + 1.05 * Math.PI);
  p.stroke();
  p.strokeStyle = '#b3261e';
  p.lineWidth = 3;
  const n = -Math.PI * 1.25 + 0.6 * Math.PI * 1.5;
  p.beginPath();
  p.moveTo(-Math.cos(n) * 8, -Math.sin(n) * 8);
  p.lineTo(Math.cos(n) * 46, Math.sin(n) * 46);
  p.stroke();
  p.font = '10px Arial';
  p.fillText('bar', 0, 22);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return mat(0xffffff, { map: tex, alphaTest: 0.5, roughness: 0.25, name: 'Gauge face' });
}

/** Silver rating plate of the servo motors: maker band, type line, small print and a code. */
function ratingPlate(): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 156;
  const p = c.getContext('2d')!;
  p.fillStyle = '#c9cdcc';
  p.fillRect(0, 0, 256, 156);
  p.fillStyle = '#2a3336';
  p.fillRect(0, 0, 256, 34);
  p.fillStyle = '#e8ece9';
  p.font = 'bold 24px Arial';
  p.fillText('SERVO  AC', 10, 25);
  p.fillStyle = '#1f2628';
  p.font = 'bold 17px Arial';
  p.fillText('MSM-04  400 W  3000 rpm', 10, 60);
  p.font = '13px Arial';
  for (let i = 0; i < 4; i++) p.fillText(['200 V  2.6 A  1.27 Nm', 'IP65  Ins. F  IEC 60034', 'Enc 23 bit abs.  S/N 4471', 'Made in EU  CE'][i], 10, 84 + i * 18);
  for (let i = 0; i < 18; i++) p.fillRect(196 + (i % 6) * 8, 92 + Math.floor(i / 6) * 8, (i * 7) % 3 ? 6 : 3, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return mat(0xffffff, { map: tex, metalness: 0.35, roughness: 0.4, name: 'Motor nameplate' });
}

/**
 * Machine vision camera looking down its local -y with a ring light, `size` the housing height
 * (the catalogue model is 0.056). `ring` lights the diffuser (flashed while exposing).
 */
export function visionCamera(size: number, ring: THREE.Material): THREE.Object3D {
  const cam = hardware('VisionCamera');
  cam.scale.setScalar(size / 0.056);
  cam.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material) && mesh.material.name === 'Ring light') mesh.material = ring;
  });
  return cam;
}

export function hardware(name: (typeof components)[number], x = 0, y = 0, z = 0): THREE.Object3D {
  const obj = kit.get(name)!.clone(true);
  obj.position.set(x, y, z);
  return obj;
}

export const finish = {
  powder: mat(0xc9ccc6, { roughness: 0.44, metalness: 0 }),
  graphite: mat(0x383e40, { roughness: 0.4, metalness: 0.62 }),
  seal: mat(0x202828, { roughness: 0.69 }),
  pipe: mat(0x2d6372, { roughness: 0.32 }),
  zinc: mat(0xbcc3c3, { metalness: 1, roughness: 0.22 }),
  brass: mat(0xa18a56, { metalness: 0.75, roughness: 0.34 }),
  glass: mat(0xafd3cd, { transparent: true, opacity: 0.072, depthWrite: false, roughness: 0.15, side: THREE.DoubleSide }),
};

export function block(g: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = box(w, h, d, m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

export function round(g: THREE.Object3D, x: number, y: number, z: number, r: number, h: number, m: THREE.Material, seg = 20): THREE.Mesh {
  const mesh = cyl(r, h, m, seg);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** Profile spanning two points, including the undercuts on each face. */
export function profile(g: THREE.Object3D, from: number[], to: number[], width = 0.04): THREE.Object3D {
  const v = new THREE.Vector3().fromArray(from);
  const delta = new THREE.Vector3().fromArray(to).sub(v);
  const p = hardware('Profile40', v.x, v.y, v.z);
  p.scale.set(width / 0.04, delta.length(), width / 0.04);
  p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  g.add(p);
  return p;
}

const collar = mat(0x2b5f9e, { roughness: 0.38 });
const UP = new THREE.Vector3(0, 1, 0);

/** A short cylinder from `p` along `dir`. */
function along(g: THREE.Object3D, p: THREE.Vector3, dir: THREE.Vector3, r: number, len: number, m: THREE.Material, seg = 10): void {
  const c = cyl(r, len, m, seg);
  c.quaternion.setFromUnitVectors(UP, dir);
  c.position.copy(p).addScaledVector(dir, len / 2);
  g.add(c);
}

/**
 * Air line or cable through the given points. Air lines (`finish.pipe`) end in push-in fittings
 * with a release collar, cables in a gland nut; longer runs are tied at their inner points.
 */
export function hose(g: THREE.Object3D, coords: number[][], r = 0.003, m: THREE.Material = finish.seal, ends = true): void {
  const path = new THREE.CatmullRomCurve3(coords.map((p) => new THREE.Vector3().fromArray(p)));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, coords.length * 5, r, 6, false), m);
  g.add(tube);
  if (!ends) return;
  const air = m === finish.pipe;
  for (const t of [0, 1]) {
    const p = path.getPointAt(t);
    const out = path.getTangentAt(t).multiplyScalar(t ? 1 : -1);
    if (air) {
      along(g, p.clone().addScaledVector(out, -r * 1.2), out, r * 1.55, r * 1.4, collar);
      along(g, p.clone().addScaledVector(out, r * 0.2), out, r * 1.35, r * 3.2, finish.zinc);
    } else along(g, p.clone().addScaledVector(out, -r * 0.8), out, r * 1.5, r * 2.6, finish.graphite, 6);
  }
  if (coords.length >= 5)
    for (let i = 1; i < coords.length - 1; i++) {
      const t = i / (coords.length - 1);
      const dir = path.getTangentAt(t);
      along(g, path.getPointAt(t).addScaledVector(dir, -0.0015), dir, r * 1.3, 0.003, finish.seal, 8);
    }
}

/**
 * Where a cable or air line goes down through a deck (at height `y`): a rubber grommet in a
 * flanged cut-out, so the line visibly continues below instead of ending on the table.
 */
export function gland(g: THREE.Object3D, x: number, y: number, z: number, r = 0.004): void {
  round(g, x, y + 0.0008, z, r * 2.8, 0.0016, finish.graphite, 20);
  round(g, x, y + 0.0022, z, r * 1.7, 0.0028, finish.seal, 20);
}

const decals = new Map<string, THREE.MeshStandardMaterial>();
/** Pad-printed equipment plate with a coloured register and two lines of type. */
export function plate(
  g: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  title: string,
  sub: string,
  accent = '#276c6e',
  angle = 0,
): THREE.Mesh {
  const key = [title, sub, accent].join('|');
  let m = decals.get(key);
  if (!m) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 144;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#e8e9df';
    c.fillRect(0, 0, 512, 144);
    c.fillStyle = accent;
    c.fillRect(0, 0, 16, 144);
    c.fillStyle = '#202f32';
    c.font = 'bold 69px Arial';
    c.fillText(title, 32, 76, 452);
    c.font = 'bold 29px Arial';
    c.fillText(sub, 34, 121, 446);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    m = mat(0xffffff, { map: tex, roughness: 0.52 });
    decals.set(key, m);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = angle;
  g.add(mesh);
  return mesh;
}

/** Bake a rigid group into one draw per finish. Positions stay local to the group. */
export function batch(group: THREE.Group): void {
  const meshes: THREE.Mesh[] = [];
  group.traverseVisible((o) => {
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) meshes.push(o);
  });
  const merged = mergeByMaterial(group, meshes);
  group.clear();
  for (const mesh of merged) group.add(mesh);
}

/**
 * One mesh per material from `meshes`, in `root`'s local frame (the meshes are left in place).
 * Clear finishes don't cast shadows.
 */
export function mergeByMaterial(root: THREE.Object3D, meshes: THREE.Mesh[]): THREE.Mesh[] {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const sets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const o of meshes) {
    const copy = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    copy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const attr of Object.keys(copy.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attr)) copy.deleteAttribute(attr);
    }
    if (!copy.attributes.normal) copy.computeVertexNormals();
    if (!copy.attributes.uv) copy.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(copy.attributes.position.count * 2), 2));
    const material = o.material as THREE.Material;
    const list = sets.get(material) ?? [];
    list.push(copy);
    sets.set(material, list);
  }
  const out: THREE.Mesh[] = [];
  for (const [material, geometries] of sets) {
    const geometry = mergeGeometries(geometries);
    for (const copy of geometries) copy.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !material.transparent || material.name === 'Drug';
    mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}

/**
 * Merges a loaded model's rigid sub-meshes into one per material, keeping the meshes `keep`
 * selects (labels and other parts the view changes) as they are, so every copy draws cheaper.
 */
export function compact(root: THREE.Object3D, keep: (m: THREE.Mesh) => boolean = () => false): void {
  const merge: THREE.Mesh[] = [];
  const kept: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) (keep(o) ? kept : merge).push(o);
  });
  const merged = mergeByMaterial(root, merge);
  for (const o of kept) root.attach(o);
  for (const o of merge) o.removeFromParent();
  for (const o of [...root.children]) if (!(o instanceof THREE.Mesh) && o.children.length === 0) o.removeFromParent();
  for (const mesh of merged) root.add(mesh);
}

/** Laminated yellow/white ISO-style warning decal, sized for guarding. */
let warningMaterial: THREE.MeshStandardMaterial;
export function warning(g: THREE.Object3D, x: number, y: number, z: number, w: number, angle = 0): void {
  if (!warningMaterial) {
    const c = document.createElement('canvas');
    c.width = 384;
    c.height = 140;
    const p = c.getContext('2d')!;
    p.fillStyle = '#eeede3';
    p.fillRect(0, 0, 384, 140);
    p.fillStyle = '#1d2726';
    p.fillRect(0, 0, 384, 7);
    p.fillStyle = '#dfb74d';
    p.fillRect(0, 7, 125, 133);
    p.fillStyle = '#192421';
    p.beginPath();
    p.moveTo(62, 24);
    p.lineTo(114, 118);
    p.lineTo(10, 118);
    p.closePath();
    p.fill();
    p.fillStyle = '#edc251';
    p.beginPath();
    p.moveTo(62, 37);
    p.lineTo(103, 111);
    p.lineTo(21, 111);
    p.closePath();
    p.fill();
    p.fillStyle = '#16231f';
    p.font = 'bold 66px Arial';
    p.fillText('!', 50, 102);
    p.font = 'bold 36px Arial';
    p.fillText('CAUTION', 140, 54);
    p.font = '24px Arial';
    p.fillText('Moving equipment', 141, 88);
    p.font = '19px Arial';
    p.fillText('Isolate before service', 141, 117);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    warningMaterial = mat(0xffffff, { map: tex, roughness: 0.62 });
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 140) / 384), warningMaterial);
  mesh.position.set(x, y, z);
  mesh.rotation.y = angle;
  g.add(mesh);
}

/** Repeated, untracked product stock. Keep the marks and transparent parts
 * of the visible prototype, and share one draw per finish across the rack. */
export class StockInstances {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  constructor(prototype: THREE.Object3D, transforms: THREE.Matrix4[]) {
    const rigid = new THREE.Group();
    rigid.add(prototype);
    // Hidden labels on unprocessed stock and hidden assembly stages are not
    // part of this template. All copies have the same bill of materials.
    batch(rigid);
    for (const part of rigid.children) {
      if (!(part instanceof THREE.Mesh)) continue;
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, transforms.length);
      transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      mesh.castShadow = !part.material.transparent;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    this.group.userData.product = true;
  }
  count(n: number): void {
    this.group.visible = n > 0;
    for (const mesh of this.meshes) mesh.count = n;
  }
}
