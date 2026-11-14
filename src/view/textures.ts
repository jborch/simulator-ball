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
  g.font = 'bold 104px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n).padStart(2, '0'), c.width / 2, c.height / 2 + 6);
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
  bwipjs.toCanvas(c, { bcid: 'gs1datamatrix', text: gs1, scale: 8, padding: 1, barcolor: '3a3a3c', backgroundcolor: 'ebebe6' });
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
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2a2d31';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#383c42';
  g.fillRect(0, 0, 64, 10);
  const tex = canvasTexture(c, true);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
