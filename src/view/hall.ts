// A panel-built production room with flush observation glazing onto a second
// service gallery. The shell cuts away as the operator orbits outside it.
import * as THREE from 'three';
import { applyContactMap } from './occlusion';
import { mat } from './build';
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

const wallMap = canvasMap(256, (c) => {
  const wash = c.createLinearGradient(0, 0, 0, 256);
  wash.addColorStop(0, '#f7f7f0');
  wash.addColorStop(0.58, '#dedfd7');
  wash.addColorStop(0.97, '#c0c6c0');
  wash.addColorStop(1, '#b6bdb8');
  c.fillStyle = wash;
  c.fillRect(0, 0, 256, 256);
});
const wall = mat(0xd3d9d5, { map: wallMap, roughness: 0.58, metalness: 0.16 });
const trim = mat(0x828e8d, { roughness: 0.43, metalness: 0.5 });
const dark = mat(0x445253, { roughness: 0.49, metalness: 0.35 });
const door = mat(0x859fa0, { roughness: 0.37, metalness: 0.38 });
const beacon = mat(0xfff5dd, { emissive: 0xfff6e2, emissiveIntensity: 2.5 });
const galleryGlass = mat(0xb4cbcb, { transparent: true, opacity: 0.22, roughness: 0.18, metalness: 0.4, depthWrite: false });
const sill = mat(0x849897, { roughness: 0.52, metalness: 0.22 });
const amber = mat(0xb49856, { metalness: 0.66, roughness: 0.4 });
const safetyRed = mat(0xa44537, { roughness: 0.36, metalness: 0.28 });

function floor(): THREE.Mesh {
  // Speckled resin, saw cuts and slightly burnished slab edges. One repeat = 2.8 m.
  const tex = canvasMap(512, (c) => {
    const img = c.createImageData(512, 512);
    let seed = 17;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = (seed / 4294967296 - 0.5) * 9;
      img.data.set([145 + grain, 151 + grain, 150 + grain, 255], i);
    }
    c.putImageData(img, 0, 0);
    c.fillStyle = 'rgba(64,73,70,.48)';
    c.fillRect(0, 0, 1.4, 512);
    c.fillRect(0, 0, 512, 1.4);
    c.fillStyle = 'rgba(223,225,218,.47)';
    c.fillRect(1.4, 0, 1, 512);
    c.fillRect(0, 1.4, 512, 1);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(33.6, 33.6), mat(0xffffff, { map: tex, roughness: 0.54, metalness: 0.15 }));
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

function wallRun(length: number, gallery: boolean, bayName: string): THREE.Group {
  const g = new THREE.Group();
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
      block(g, x, 2.1, -2.0, pitch + 0.01, 4.2, 0.12, wall);
      block(g, x - 0.72, 1.9, -1.85, 0.08, 3.8, 0.1, trim);
      for (const h of [2.36, 2.45]) block(g, x, h, -1.65, pitch, 0.042, 0.055, trim);
      if (i % 3 === 2) {
        for (const dx of [-0.48, 0.27]) {
          round(g, x + dx, 0.96, -1.36, 0.256, 1.56, trim, 32);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.255, 24, 12), trim);
          head.position.set(x + dx, 1.74, -1.36);
          head.scale.y = 0.4;
          g.add(head);
          for (const y of [0.44, 1.52]) round(g, x + dx, y, -1.36, 0.258, 0.023, dark, 32);
          round(g, x + dx, 1.95, -1.36, 0.039, 0.39, trim);
          round(g, x + dx, 2.12, -1.36, 0.063, 0.018, dark);
        }
      } else {
        block(g, x + 0.3, 0.91, -1.43, 0.82, 1.82, 0.48, door);
        block(g, x + 0.29, 0.94, -1.181, 0.009, 1.72, 0.01, dark);
        block(g, x + 0.35, 1.09, -1.17, 0.018, 0.16, 0.025, dark);
        for (let j = 0; j < 6; j++) block(g, x + 0.09, 1.53 + j * 0.031, -1.183, 0.25, 0.013, 0.015, trim);
        plate(g, x + 0.49, 1.52, -1.183, 0.18, 0.057, 'AHU', 'AIR HANDLING');
      }
      block(g, x, 2.82, -1.19, 1.32, 0.065, 0.11, beacon);
    } else {
      block(g, x, 2.25, 0, pitch - 0.012, 4.5, 0.12, wall);
      block(g, x, 0.48, 0.063, pitch - 0.012, 0.96, 0.014, sill);
      if (i % 3 !== 0) {
        plate(
          g,
          x,
          1.83,
          0.066,
          1.29,
          0.36,
          bayName.startsWith('AIRLOCK 0') ? 'PROCESS  /  07' : 'UTILITY  /  03',
          'PEN ASSEMBLY   •   CONTROLLED AREA',
        );
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
        plate(g, x, 2.46, 0.067, 0.74, 0.19, bayName, 'CONTROLLED ACCESS');
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
  block(g, 0, 2.2, -2.15, length + 4, 4.5, 0.12, wall);
  block(g, 0, 0.035, -1.12, length + 4, 0.06, 2.25, trim);
  block(g, 0, 3.18, -1.12, length + 4, 0.09, 2.25, wall);
  batch(g);
  for (const o of g.children) o.castShadow = false;
  return g;
}
const matGlass = mat(0x526e73, { metalness: 0.45, roughness: 0.16 });

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
