import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, test } from 'vitest';
import { LINE } from '../sim/config';
import { pose } from '../sim/track';
import { BELT_Y, BELT_W, TABLE, v3 } from './build';
import { CameraMountsView, mountLayer, viewThrough } from './cameramounts';
import { CAMERAS, cameraPose } from './cameras';
import { InspectionView } from './devices';
import type { Models } from './models';

let mounts: CameraMountsView;

beforeAll(async () => {
  const file = readFileSync(new URL('../../public/models/camera_mount.glb', import.meta.url));
  const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().parseAsync(data, '');
  mounts = new CameraMountsView(LINE, { camera_mount: gltf.scene } as unknown as Models);
});

function mountOf(id: string): THREE.Object3D {
  return mounts.group.getObjectByName(`mount-${id}`)!;
}

/**
 * Boxes that enclose a mesh: its own box for a rigid part, a small box around each vertex for the
 * cable, whose bends would make one box cover empty space.
 */
function solids(m: THREE.Mesh): THREE.Box3[] {
  if (m.name !== 'cable') return [new THREE.Box3().setFromObject(m, true)];
  const pos = m.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  return Array.from({ length: pos.count }, (_, i) => new THREE.Box3().setFromCenterAndSize(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld), new THREE.Vector3(0.001, 0.001, 0.001)));
}

function meshes(o: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) out.push(m as THREE.Mesh);
  });
  return out;
}

describe('camera mounts', () => {
  test('every station camera has a mount standing on the table', () => {
    for (const cam of CAMERAS) {
      const box = new THREE.Box3().setFromObject(mountOf(cam.id));
      expect(box.min.y, cam.id).toBeCloseTo(BELT_Y + TABLE, 3);
      // Reaches up to the camera.
      expect(box.max.y, cam.id).toBeGreaterThan(cameraPose(LINE, cam).position.y);
    }
  });

  test('a camera cannot see its own mount: the head lies behind the lens, the rest below the picture', () => {
    const v = new THREE.Vector3();
    for (const cam of CAMERAS) {
      const pose = cameraPose(LINE, cam);
      const view = new THREE.PerspectiveCamera(pose.fov, 16 / 9, 0.01, 100);
      view.position.copy(pose.position);
      view.lookAt(pose.target);
      view.updateMatrixWorld();
      // At the nominal pose; the bottom edge widened a little. (Under camera realism's per-run
      // offset it's the render layer that keeps the mount out of the picture; see the last test.)
      const h = THREE.MathUtils.degToRad((pose.fov * 1.04) / 2 + 2);
      const head = mountOf(cam.id).getObjectByName('cam_head')!;
      let ahead = -Infinity;
      let belowEdge = -Infinity;
      for (const m of meshes(mountOf(cam.id))) {
        let inHead = false;
        m.traverseAncestors((a) => (inHead ||= a === head));
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(view.matrixWorldInverse);
          // A three.js camera looks down -z.
          if (inHead) ahead = Math.max(ahead, -v.z);
          else belowEdge = Math.max(belowEdge, v.y * Math.cos(h) - v.z * Math.sin(h));
        }
      }
      expect(ahead, `${cam.id}: head reaches past the lens`).toBeLessThan(view.near);
      expect(belowEdge, `${cam.id}: post in the picture`).toBeLessThan(-0.005);
    }
  });

  test('mounts stay clear of the belts and the movers and pens riding them', () => {
    // On each straight: the belt frame and the movers on it, and above them the pens.
    const S = LINE.track.straight;
    const R = LINE.track.radius;
    const frame = BELT_W / 2 + 0.015;
    const moverTop = BELT_Y + LINE.mover.seat + 0.03;
    const penTop = BELT_Y + LINE.mover.seat + LINE.parts.housing.seat + LINE.parts.housing.length + 0.01;
    const corridors = [-1, 1].flatMap((side) => [
      new THREE.Box3(new THREE.Vector3(-S / 2, BELT_Y + TABLE + 0.001, side * R - frame), new THREE.Vector3(S / 2, moverTop, side * R + frame)),
      new THREE.Box3(new THREE.Vector3(-S / 2, BELT_Y, side * R - 0.03), new THREE.Vector3(S / 2, penTop, side * R + 0.03)),
    ]);
    for (const cam of CAMERAS) {
      for (const m of meshes(mountOf(cam.id))) {
        for (const part of solids(m)) for (const c of corridors) expect(part.intersectsBox(c), `${cam.id} ${m.name}`).toBe(false);
      }
    }
  });

  test('mounts keep clear of the inspection stations (e.g. EM50\'s side reader by the springbase camera)', () => {
    const equipment: THREE.Box3[] = [];
    for (const def of LINE.stations.filter((s) => s.kind === 'inspect')) {
      const view = new InspectionView(LINE, !!def.readsCode);
      const p = pose(LINE.track, def.s);
      view.group.position.copy(v3(p.x, p.y, BELT_Y));
      view.group.rotation.y = p.heading;
      view.group.updateMatrixWorld(true);
      for (const m of meshes(view.group)) equipment.push(new THREE.Box3().setFromObject(m, true));
    }
    for (const cam of CAMERAS) {
      for (const m of meshes(mountOf(cam.id))) {
        for (const part of solids(m)) {
          const near = part.clone().expandByScalar(0.002);
          for (const e of equipment) expect(near.intersectsBox(e), `${cam.id} ${m.name}`).toBe(false);
        }
      }
    }
  });

  test('only a few large parts of each mount cast shadows', () => {
    for (const cam of CAMERAS) {
      const casters = meshes(mountOf(cam.id)).filter((m) => m.castShadow).length;
      expect(casters, cam.id).toBeGreaterThan(0);
      expect(casters, cam.id).toBeLessThanOrEqual(4);
    }
  });

  test("a view through a camera leaves out that camera's own mount, and only that one", () => {
    const view = new THREE.PerspectiveCamera();
    for (const cam of CAMERAS) {
      viewThrough(view, cam.id);
      for (const other of CAMERAS) {
        const seen = meshes(mountOf(other.id)).every((m) => m.layers.test(view.layers));
        const hidden = meshes(mountOf(other.id)).every((m) => !m.layers.test(view.layers));
        if (other.id === cam.id) expect(hidden, `${cam.id} sees itself`).toBe(true);
        else expect(seen, `${cam.id} sees ${other.id}`).toBe(true);
      }
      // The rest of the scene (layer 0) stays in view.
      expect(view.layers.isEnabled(0)).toBe(true);
    }
    viewThrough(view, null);
    for (const cam of CAMERAS) expect(view.layers.isEnabled(mountLayer(cam.id)), cam.id).toBe(true);
  });
});
