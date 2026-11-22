import bwipjs from 'bwip-js/browser';
import * as THREE from 'three';

/** glTF meshes use top-left UV origin, so textures painted onto Blender label patches must not flip. */
function canvasTexture(canvas: HTMLCanvasElement, flipY = false): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.flipY = flipY;
  return tex;
}

/**
 * Laminated carrier ID plate: two-digit number and a small code strip, at width/height `aspect`.
 * `flat`: the plate on the carrier's top, which the station cameras see almost edge-on (squashed
 * several times over): just the number, heavy and plate-high, in a broad border.
 */
export function numberTexture(n: number, aspect = 2, flat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  const W = flat ? 1024 : 512;
  const s = W / 512;
  c.width = W;
  c.height = Math.round(W / aspect);
  const g = c.getContext('2d')!;
  const h = c.height;
  g.fillStyle = '#f6f6f2';
  g.fillRect(0, 0, c.width, h);
  g.fillStyle = '#121416';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (flat) {
    // The top plate is seen almost edge-on by the station cameras: only a heavy number, as tall
    // as the plate allows, with a broad border (thin keylines and bars squash into stripes).
    g.strokeStyle = '#2a2f33';
    g.lineWidth = h * 0.07;
    g.strokeRect(h * 0.035, h * 0.035, c.width - h * 0.07, h - h * 0.07);
    g.font = `bold ${Math.round(h * 0.86)}px Arial, Helvetica, sans-serif`;
    g.fillText(String(n).padStart(2, '0'), c.width / 2, h / 2 + h * 0.05);
    const tex = canvasTexture(c);
    tex.anisotropy = 16;
    return tex;
  }
  // Thin printed keyline just inside the laminate edge.
  g.strokeStyle = '#2a2f33';
  g.lineWidth = 5 * s;
  g.strokeRect(9 * s, 9 * s, c.width - 18 * s, h - 18 * s);
  g.font = `bold ${Math.round(h * 0.78)}px Arial, Helvetica, sans-serif`;
  g.fillText(String(n).padStart(2, '0'), c.width * 0.42, h / 2 + h * 0.045);
  g.fillStyle = '#2b3438';
  for (let i = 0; i < 11; i++) {
    const w = (((n >> i % 6) % 2) * 3 + 3) * s;
    g.fillRect((392 + i * 9) * s, h * 0.2, w, h * 0.6);
  }
  const tex = canvasTexture(c);
  tex.anisotropy = 16;
  return tex;
}

const dmCache = new Map<string, THREE.CanvasTexture>();
const DM_CACHE_MAX = 96;

/** Laser-mark style GS1 DataMatrix for an identifier like "(01)…(17)…(10)…(21)…". Cached. */
export function dataMatrixTexture(gs1: string): THREE.CanvasTexture {
  const hit = dmCache.get(gs1);
  if (hit) {
    dmCache.delete(gs1);
    dmCache.set(gs1, hit);
    return hit;
  }
  const c = document.createElement('canvas');
  // With the long axis along the pen, fewer modules wrap away from a
  // level inspection camera. The GS1 payload is identical in both formats.
  const print = { bcid: 'gs1datamatrix', text: gs1, scale: 8, padding: 1, barcolor: '13191b', backgroundcolor: 'f2f2eb' };
  const rectangular = { ...print, format: 'rectangle', rotate: 'R' as const };
  try {
    bwipjs.toCanvas(c, rectangular);
  } catch {
    // A longer identifier may exceed the capacity of rectangular ECC 200.
    bwipjs.toCanvas(c, print);
  }
  const tex = canvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  dmCache.set(gs1, tex);
  if (dmCache.size > DM_CACHE_MAX) {
    const [oldKey, old] = dmCache.entries().next().value!;
    dmCache.delete(oldKey);
    old.dispose();
  }
  return tex;
}

/**
 * Belt strand surface: anthracite PU over a fabric carcass. A fine, even twill and grain (u across
 * the strand, one repeat of v = 50 mm along it) that shows the belt moving without a pattern
 * that would beat into moiré at a distance, and the sealed, slightly lighter edges.
 */
export function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  const data = g.createImageData(c.width, c.height);
  let seed = 311;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const twill = (x + 2 * y) % 4 < 2 ? 1.2 : -1.2;
      const edge = x < 3 || x > 124 ? 16 : x < 5 || x > 122 ? -6 : 0;
      const v = 47 + twill + (rnd() - 0.5) * 7 + edge;
      data.data.set([v, v + 1, v + 2, 255], 4 * (x + y * c.width));
    }
  g.putImageData(data, 0, 0);
  const tex = canvasTexture(c, true);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  return tex;
}

/** Metres of deck one repeat of the brushed finish covers (along and across the grain). */
export const BRUSHED_REPEAT = { u: 0.5, v: 0.07 };

/**
 * Fine brushed grain for stainless plate: random grain lines along u (one texel ≈ 0.27 mm), in
 * the colour (very faint) and the roughness. No scratches or patches, nothing that would show
 * the repeat: a cleanroom deck, not a workshop bench. Sized by `BRUSHED_REPEAT`, so the meshes'
 * UVs must be in those units (see `brushedUv`).
 */
let brushed: { map: THREE.DataTexture; rough: THREE.DataTexture } | null = null;
export function brushedFinish(): { map: THREE.DataTexture; rough: THREE.DataTexture } {
  if (brushed) return brushed;
  const W = 1024;
  const H = 256;
  const color = new Uint8Array(W * H * 4);
  const rough = new Uint8Array(W * H * 4);
  let seed = 931;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Each grain line has its own depth, and drifts slowly along its length.
  const line = Array.from({ length: H }, () => ({ k: rnd() - 0.5, phase: rnd() * Math.PI * 2, f: 1 + Math.floor(rnd() * 3) }));
  for (let y = 0; y < H; y++) {
    const { k, phase, f } = line[y];
    for (let x = 0; x < W; x++) {
      const drift = 0.5 * Math.sin((x / W) * Math.PI * 2 * f + phase);
      const g = 0.8 * k + 0.12 * drift + (rnd() - 0.5) * 0.22;
      const i = 4 * (x + y * W);
      const c = 238 + g * 9;
      color.set([c, c, c, 255], i);
      const r = 86 + g * 12;
      rough.set([r, r, r, 255], i);
    }
  }
  const make = (data: Uint8Array, srgb: boolean) => {
    const tex = new THREE.DataTexture(data, W, H);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 16;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };
  brushed = { map: make(color, true), rough: make(rough, false) };
  return brushed;
}

/**
 * Rescales a box's UVs from 0..1 per face to metres in `BRUSHED_REPEAT` units (grain along x),
 * so the brushed finish keeps its scale whatever the plate's size.
 */
export function brushedUv(mesh: THREE.Mesh, w: number, d: number): void {
  const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / BRUSHED_REPEAT.u, (uv.getY(i) * d) / BRUSHED_REPEAT.v);
  uv.needsUpdate = true;
}

/** Grime and scuffs for worn carriers: a colour map near white with smudges, and its roughness. */
let wear: { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;
export function carrierWear(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  if (wear) return wear;
  const make = (paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, color: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    let seed = 4711;
    paint(ctx, () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296));
    const tex = new THREE.CanvasTexture(c);
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  // Grime gathers in soft patches; scuffs are short and run along the direction of travel (u),
  // and only change the gloss: dark random strokes in the colour read as veins in marble.
  const marks = (ctx: CanvasRenderingContext2D, rnd: () => number, base: string, smudge: (a: number) => string, line: ((a: number) => string) | null) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 18; i++) {
      const x = rnd() * 256,
        y = rnd() * 256,
        r = 14 + rnd() * 44;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, smudge(0.08 + rnd() * 0.12));
      g.addColorStop(1, smudge(0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    if (!line) return;
    ctx.filter = 'blur(0.6px)';
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = line(0.12 + rnd() * 0.18);
      ctx.lineWidth = 0.8 + rnd() * 1.2;
      const x = rnd() * 256,
        y = rnd() * 256,
        a = (rnd() - 0.5) * 0.25;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (8 + rnd() * 20), y + Math.sin(a) * (8 + rnd() * 20));
      ctx.stroke();
    }
    ctx.filter = 'none';
  };
  wear = {
    map: make((ctx, rnd) => marks(ctx, rnd, '#ffffff', (a) => `rgba(128,124,114,${a})`, null), true),
    rough: make((ctx, rnd) => marks(ctx, rnd, '#ffffff', (a) => `rgba(205,205,205,${a})`, (a) => `rgba(150,150,150,${a})`), false),
  };
  return wear;
}

/**
 * Cleanroom coverall fabric, tinted by the garment colour: fine weave, side seams with stitching,
 * soft folds and (on the body, `zip`) the front zip at u = 0.25. Shared by every operator.
 */
const fabrics = new Map<boolean, THREE.CanvasTexture>();
export function fabricTexture(zip = true): THREE.CanvasTexture {
  const cached = fabrics.get(zip);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const img = g.createImageData(512, 512);
  let seed = 2027;
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const weave = ((x + y) % 4 < 2 ? 4 : -4) + (seed / 4294967296 - 0.5) * 10;
      const v = 236 + weave;
      img.data.set([v, v, v, 255], 4 * (x + y * 512));
    }
  g.putImageData(img, 0, 0);
  let s2 = 77;
  const rnd = () => ((s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Folds: long soft shadows, mostly diagonal and around the joints.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 512,
      y = rnd() * 512,
      len = 60 + rnd() * 160,
      a = -0.4 + rnd() * 0.8 + (rnd() < 0.5 ? 0 : Math.PI / 2);
    g.strokeStyle = `rgba(90,96,100,${0.05 + rnd() * 0.07})`;
    g.lineWidth = 10 + rnd() * 18;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + 20, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  // Side seams with stitching, and the front zip with its placket.
  for (const u of [0, 0.5, 1]) {
    const x = u * 512;
    g.fillStyle = 'rgba(70,76,80,.45)';
    g.fillRect(x - 2, 0, 4, 512);
    g.fillStyle = 'rgba(255,255,255,.6)';
    for (let y = 0; y < 512; y += 8) g.fillRect(x + 4, y, 1.5, 4);
  }
  if (zip) {
    g.fillStyle = 'rgba(60,66,70,.5)';
    g.fillRect(124, 120, 7, 392);
    g.fillStyle = 'rgba(160,166,170,.8)';
    for (let y = 120; y < 512; y += 5) g.fillRect(125, y, 5, 2);
    g.fillStyle = 'rgba(80,86,90,.35)';
    g.fillRect(132, 120, 3, 392);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  fabrics.set(zip, tex);
  return tex;
}
