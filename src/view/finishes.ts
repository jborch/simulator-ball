// Surface finishes, so the machine's materials read apart under the hall's soft light: cool,
// semi-gloss anodised extrusions; warm, slightly textured RAL 7035 powder coat on the cabinets;
// finely brushed stainless decks with a stretched sheen; white polymer carrier housings with matte
// black POM nests; satin moulded pen bodies that differ a little from one moulding to the next.
// The Blender models keep their geometry; their finishes are tuned here by material name.
import * as THREE from 'three';
import { mat } from './build';

const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function dataTexture(size: number, fill: (x: number, y: number) => [number, number, number], srgb = false): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], 4 * (x + y * size));
    }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Orange peel of a powder coat: a smooth random height field (a few octaves of value noise,
 * wrapping) as a normal map, and the faint gloss variation that goes with it.
 */
let peel: { normal: THREE.DataTexture; rough: THREE.DataTexture } | null = null;
function orangePeel(): { normal: THREE.DataTexture; rough: THREE.DataTexture } {
  if (peel) return peel;
  const N = 256;
  const rnd = lcg(5151);
  const height = new Float32Array(N * N);
  for (const [cells, amp] of [
    [16, 1],
    [32, 0.6],
    [64, 0.35],
  ] as const) {
    const grid = Array.from({ length: cells * cells }, () => rnd());
    const at = (i: number, j: number) => grid[((j + cells) % cells) * cells + ((i + cells) % cells)];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const u = (x / N) * cells;
        const v = (y / N) * cells;
        const i = Math.floor(u);
        const j = Math.floor(v);
        const s = (u - i) * (u - i) * (3 - 2 * (u - i));
        const t = (v - j) * (v - j) * (3 - 2 * (v - j));
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * s;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * s;
        height[y * N + x] += amp * (a + (b - a) * t);
      }
  }
  const h = (x: number, y: number) => height[((y + N) % N) * N + ((x + N) % N)];
  const normal = dataTexture(N, (x, y) => {
    const dx = (h(x + 1, y) - h(x - 1, y)) * 1.6;
    const dy = (h(x, y + 1) - h(x, y - 1)) * 1.6;
    const l = Math.hypot(dx, dy, 1);
    return [128 - (127 * dx) / l, 128 - (127 * dy) / l, (255 * 1) / l];
  });
  const rough = dataTexture(N, (x, y) => {
    const k = 150 + (h(x, y) - 0.95) * 40;
    return [k, k, k];
  });
  peel = { normal, rough };
  return peel;
}

/** Powder-coated sheet steel (cabinet doors, motor covers): satin, with an orange-peel texture. */
export function powderCoat(color: number): THREE.MeshStandardMaterial {
  const p = orangePeel();
  return mat(color, { roughness: 0.62, roughnessMap: p.rough, normalMap: p.normal, normalScale: new THREE.Vector2(0.06, 0.06), metalness: 0 });
}

/** Clear-anodised aluminium extrusion: cool, semi-gloss, a little milky (the oxide layer). */
export const anodised = mat(0xa9b1b9, { metalness: 0.8, roughness: 0.36, name: 'Anodised extrusion' });

/** glTF finish adjustments by material name: [colour (linear), roughness, metalness]. */
const TUNED: Record<string, { color?: [number, number, number]; roughness?: number; metalness?: number }> = {
  // Bead blasted parts (covers, carriages): matte satin, so the anodised profiles stand apart.
  'Bead blasted aluminium': { color: [0.54, 0.56, 0.56], roughness: 0.44, metalness: 0.88 },
  // RAL 9002 grey white rather than paper white.
  'Press enamel': { color: [0.6, 0.61, 0.57], roughness: 0.42 },
  // Carrier housings: white polymer; the nests are matte black POM, not glossy metal.
  MoverBody: { color: [0.64, 0.65, 0.63], roughness: 0.46 },
  FixtureBlack: { color: [0.026, 0.028, 0.031], roughness: 0.64, metalness: 0 },
  // Thermoformed HIPS trays: an off-white, not the brightest thing in the hall.
  TrayHIPS: { color: [0.6, 0.62, 0.61], roughness: 0.4 },
  // Injection-moulded pen bodies: satin, not lacquered.
  HousingBlue: { roughness: 0.4 },
};

/** Applies `TUNED` to the materials of a loaded model (each material once). */
export function refinish(root: THREE.Object3D): void {
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || done.has(mesh.material)) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    done.add(m);
    const t = TUNED[m.name];
    if (!t) return;
    if (t.color) m.color.setRGB(...t.color, THREE.LinearSRGBColorSpace);
    if (t.roughness !== undefined) m.roughness = t.roughness;
    if (t.metalness !== undefined) m.metalness = t.metalness;
  });
}

/**
 * Pen bodies come from several mouldings: a few shared variants of the blue, a shade lighter or
 * darker and a touch more or less glossy, handed out in turn to each housing made.
 */
const variants: THREE.Material[] = [];
let handed = 0;
export function varyMoulding(root: THREE.Object3D): void {
  const k = handed++ % 5;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material.name !== 'HousingBlue') return;
    const base = mesh.material as THREE.MeshStandardMaterial;
    if (!variants.length) {
      const rnd = lcg(808);
      for (let i = 0; i < 5; i++) {
        const v = base.clone();
        const hsl = { h: 0, s: 0, l: 0 };
        v.color.getHSL(hsl);
        v.color.setHSL(hsl.h + (rnd() - 0.5) * 0.012, hsl.s * (0.94 + rnd() * 0.1), hsl.l * (0.92 + rnd() * 0.16));
        v.roughness = base.roughness + (rnd() - 0.5) * 0.08;
        variants.push(v);
      }
    }
    mesh.material = variants[k];
  });
}
