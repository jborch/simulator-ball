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

/** Laminated carrier ID plate: two-digit number and a small code strip, at width/height `aspect`. */
export function numberTexture(n: number, aspect = 2): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round(512 / aspect);
  const g = c.getContext('2d')!;
  const h = c.height;
  g.fillStyle = '#f6f6f2';
  g.fillRect(0, 0, c.width, h);
  // Thin printed keyline just inside the laminate edge.
  g.strokeStyle = '#2a2f33';
  g.lineWidth = 5;
  g.strokeRect(9, 9, c.width - 18, h - 18);
  g.fillStyle = '#121416';
  g.font = `bold ${Math.round(h * 0.78)}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n).padStart(2, '0'), c.width * 0.42, h / 2 + h * 0.045);
  g.fillStyle = '#2b3438';
  for (let i = 0; i < 11; i++) {
    const w = ((n >> i % 6) % 2) * 3 + 3;
    g.fillRect(392 + i * 9, h * 0.2, w, h * 0.6);
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

/** Belt surface: dark rubber with cross ribs so motion is visible. */
export function beltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const data = g.createImageData(c.width, c.height);
  let seed = 311;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const yarn = ((x + y) % 5 === 0 ? 4 : 0) + (y % 4 === 0 ? 2 : 0);
      const value = 45 + yarn + (seed / 4294967296) * 8;
      data.data.set([value, value + 2, value + 1, 255], 4 * (x + y * c.width));
    }
  g.putImageData(data, 0, 0);
  g.fillStyle = '#252b29';
  g.fillRect(0, 0, 256, 2);
  g.fillStyle = '#414543';
  g.fillRect(0, 2, 256, 1);
  const tex = canvasTexture(c, true);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Brushed grain in the roughness channel, with polished wear patches and a few scratches. */
export function brushedFinish(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  let seed = 931;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < 512; y++) {
    const k = 196 + Math.round(rnd() * 36);
    ctx.fillStyle = `rgb(${k},${k},${k})`;
    ctx.fillRect(0, y, 512, 1);
  }
  // Polished patches where parts and hands rest, and short scratches across the grain.
  for (let i = 0; i < 14; i++) {
    const x = rnd() * 512,
      y = rnd() * 512,
      r = 30 + rnd() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(120,120,120,${0.25 + rnd() * 0.25})`);
    g.addColorStop(1, 'rgba(120,120,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 60; i++) {
    const k = rnd() < 0.5 ? 140 : 250;
    ctx.strokeStyle = `rgba(${k},${k},${k},${0.3 + rnd() * 0.4})`;
    ctx.lineWidth = 0.6 + rnd() * 1.2;
    const x = rnd() * 512,
      y = rnd() * 512,
      a = rnd() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * (10 + rnd() * 50), y + Math.sin(a) * (10 + rnd() * 50));
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.repeat.set(1, 2);
  return tex;
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
  const marks = (ctx: CanvasRenderingContext2D, rnd: () => number, base: string, smudge: (a: number) => string, line: (a: number) => string) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 18; i++) {
      const x = rnd() * 256,
        y = rnd() * 256,
        r = 10 + rnd() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, smudge(0.15 + rnd() * 0.2));
      g.addColorStop(1, smudge(0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = line(0.25 + rnd() * 0.4);
      ctx.lineWidth = 0.7 + rnd();
      const x = rnd() * 256,
        y = rnd() * 256,
        a = rnd() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * (6 + rnd() * 26), y + Math.sin(a) * (6 + rnd() * 26));
      ctx.stroke();
    }
  };
  wear = {
    map: make((ctx, rnd) => marks(ctx, rnd, '#ffffff', (a) => `rgba(120,118,110,${a})`, (a) => `rgba(150,150,146,${a})`), true),
    rough: make((ctx, rnd) => marks(ctx, rnd, '#ffffff', (a) => `rgba(200,200,200,${a})`, (a) => `rgba(110,110,110,${a})`), false),
  };
  return wear;
}

/**
 * Cleanroom coverall fabric, tinted by the garment colour: fine weave, side seams with stitching,
 * the front zip (u = 0.25) and soft folds. Shared by every operator.
 */
let fabric: THREE.CanvasTexture | null = null;
export function fabricTexture(): THREE.CanvasTexture {
  if (fabric) return fabric;
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
  g.fillStyle = 'rgba(60,66,70,.5)';
  g.fillRect(124, 120, 7, 392);
  g.fillStyle = 'rgba(160,166,170,.8)';
  for (let y = 120; y < 512; y += 5) g.fillRect(125, y, 5, 2);
  g.fillStyle = 'rgba(80,86,90,.35)';
  g.fillRect(132, 120, 3, 392);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  fabric = tex;
  return tex;
}
