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

/** Printed mover number label. */
export function numberTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#1d1f23';
  g.font = 'bold 100px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n).padStart(2, '0'), c.width / 2 - 12, c.height / 2 + 5);
  g.fillStyle = '#354448';
  for (let i = 0; i < 9; i++) {
    const w = ((n >> i % 5) % 2) + 1;
    g.fillRect(208 + i * 3, 19, w, 89);
  }
  return canvasTexture(c);
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

/** Fine directional finishing marks in the roughness channel. */
export function brushedFinish():THREE.CanvasTexture {
  const c=document.createElement('canvas');
  c.width=256; c.height=256;
  const ctx=c.getContext('2d')!;
  let seed=931;
  for(let y=0;y<256;y++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const k=198+Math.round(seed/4294967296*34);
    ctx.fillStyle=`rgb(${k},${k},${k})`;
    ctx.fillRect(0,y,256,1);
  }
  const tex=new THREE.CanvasTexture(c);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.anisotropy=8;
  tex.repeat.set(2,6);
  return tex;
}
