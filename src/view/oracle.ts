// Object oracle (`?capture=1&oracle=1`): ground-truth boxes of the objects a camera sees, for demos
// of object annotations in a VMS. Not a detector: it reads the scene, so its output must stay
// labelled as simulator ground truth and never be used to train or score the video analyses.
// Objects opt in with `userData.track = { cls, id }` (movers, people, robot grippers, loose items).
import * as THREE from 'three';
import type { CameraObject } from '../sim/protocol';

/** Boxes smaller than this (fraction of the frame, either side) are left out. */
const MIN_SIDE = 0.004;

const box = new THREE.Box3();
const corner = new THREE.Vector3();

/** Boxes, in fractions of the frame from the top left, of the tagged objects in the camera's view. */
export function visibleObjects(scene: THREE.Scene, camera: THREE.Camera): CameraObject[] {
  camera.updateMatrixWorld();
  const out: CameraObject[] = [];
  scene.traverseVisible((o) => {
    const track = o.userData.track as { cls: CameraObject['cls']; id: string } | undefined;
    if (!track) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let behind = 0;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      if (corner.z > 1) behind++;
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
    }
    if (behind > 0) return; // partly behind the camera: the projection isn't a box
    // Normalised device coordinates (-1..1, y up) → frame fractions (0..1, y down), clipped.
    const fx0 = Math.max(0, (x0 + 1) / 2), fx1 = Math.min(1, (x1 + 1) / 2);
    const fy0 = Math.max(0, (1 - y1) / 2), fy1 = Math.min(1, (1 - y0) / 2);
    if (fx1 - fx0 < MIN_SIDE || fy1 - fy0 < MIN_SIDE) return;
    const r = (v: number) => Math.round(v * 10000) / 10000;
    out.push({ cls: track.cls, id: track.id, box: [r(fx0), r(fy0), r(fx1 - fx0), r(fy1 - fy0)] });
  });
  return out;
}
