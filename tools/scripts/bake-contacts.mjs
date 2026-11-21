// Called by shots.mjs --bake-contacts with a fully assembled, metre-scale line.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function bakeContacts(page) {
  const dir = mkdtempSync(path.join(tmpdir(), 'line-occlusion-'));
  try {
    const { bytes, deck } = await page.evaluate(async () => {
      const { STLExporter } = await import('/node_modules/three/examples/jsm/exporters/STLExporter.js');
      const { BELT_Y, TABLE } = await import('/src/view/build.ts');
      const { THREE } = window;
      const occluders = new THREE.Group();
      const line = window.line.view.group;
      line.updateWorldMatrix(true, true);
      function collect(o) {
        if (!o.visible || o.userData.track || o.userData.mobile || o.userData.product) return;
        if (o.isMesh && !o.material.transparent && !o.isInstancedMesh) {
          const copy = new THREE.Mesh(o.geometry);
          copy.matrixAutoUpdate = false;
          copy.matrix.copy(o.matrixWorld);
          occluders.add(copy);
        }
        for (const child of o.children) collect(child);
      }
      collect(line);
      occluders.updateMatrixWorld(true);
      const stl = new STLExporter().parse(occluders, { binary: true });
      const data = new Uint8Array(stl.buffer);
      const parts = [];
      for (let i = 0; i < data.length; i += 24576) parts.push(btoa(String.fromCharCode(...data.subarray(i, i + 24576))));
      return { bytes: parts.join(''), deck: BELT_Y + TABLE };
    });
    const input = path.join(dir, 'line.stl');
    writeFileSync(input, Buffer.from(bytes, 'base64'));
    execFileSync('blender', ['-b', '--python-exit-code', '1', '-P', 'tools/blender/contacts.py', '--', input, String(deck)], { stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
