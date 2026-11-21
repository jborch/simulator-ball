// Reusable, metre-scale machine hardware. Keep moving assemblies in their own
// coordinate frames and batch only the rigid parts of a single assembly.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, mat } from './build';

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
}

export function hardware(name: (typeof components)[number], x = 0, y = 0, z = 0): THREE.Object3D {
  const obj = kit.get(name)!.clone(true);
  obj.position.set(x, y, z);
  return obj;
}

export const finish = {
  powder: mat(0xc6ccc5, { roughness: 0.36, metalness: 0.32 }),
  graphite: mat(0x374749, { roughness: 0.38, metalness: 0.65 }),
  seal: mat(0x202828, { roughness: 0.69 }),
  pipe: mat(0x2d6372, { roughness: 0.32 }),
  zinc: mat(0xbac3c2, { metalness: 0.88, roughness: 0.24 }),
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

export function hose(g: THREE.Object3D, coords: number[][], r = 0.003, m = finish.seal): void {
  const path = new THREE.CatmullRomCurve3(coords.map((p) => new THREE.Vector3().fromArray(p)));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, coords.length * 5, r, 6, false), m);
  g.add(tube);
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
  group.updateWorldMatrix(true, true);
  const inv = group.matrixWorld.clone().invert();
  const sets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverseVisible((o) => {
    if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
    const copy = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    copy.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const attr of Object.keys(copy.attributes)) {
      if (!['position', 'normal', 'uv'].includes(attr)) copy.deleteAttribute(attr);
    }
    if (!copy.attributes.uv) copy.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(copy.attributes.position.count * 2), 2));
    const list = sets.get(o.material) ?? [];
    list.push(copy);
    sets.set(o.material, list);
  });
  group.clear();
  for (const [material, geometries] of sets) {
    const geometry = mergeGeometries(geometries);
    for (const copy of geometries) copy.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = !material.transparent;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
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
