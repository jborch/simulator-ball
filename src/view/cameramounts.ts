// The station cameras as hardware on the line (tools/blender/camera_mount.py): each camera sits on a
// ball head, clamped on an aluminium post that is bolted to the table, with its cable running down
// the post. The mounts are built from the cameras' poses (cameras.ts), so each camera body sits
// exactly where its view is rendered from.
//
// A camera must never film itself. The model already lies wholly behind the lens and below the
// picture (cameramounts.test.ts checks both), and on top of that each camera's mount is on a render
// layer of its own, which the view through that camera leaves out (`viewThrough`), so neither the
// per-run mount variation (camerafx.ts) nor a later change to a camera's aim can bring it into its
// own picture. (Its shadow goes with it: shadow maps follow the viewing camera's layers.) Other
// cameras and the overview still see it.
import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { BELT_Y, TABLE } from './build';
import { CAMERAS, type CameraDef, cameraPose } from './cameras';
import type { Models } from './models';

/** Camera i's mount is on layer FIRST_LAYER + i; layer 0 is everything else. */
const FIRST_LAYER = 1;
const CABLE_R = 0.0025;
/** Half the post's width (20 mm profile). */
const POST_HALF = 0.01;

const cableMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.75 });

/** The layer camera `camId`'s own mount is on. */
export function mountLayer(camId: string): number {
  const i = CAMERAS.findIndex((c) => c.id === camId);
  if (i < 0) throw new Error(`no camera ${camId}`);
  return FIRST_LAYER + i;
}

/**
 * Sets what `camera` renders: everything, except the mount of station camera `camId` when the view
 * is through that camera (null: a free view or the overview, which show every mount).
 */
export function viewThrough(camera: THREE.Camera, camId: string | null): void {
  camera.layers.set(0);
  for (const c of CAMERAS) if (c.id !== camId) camera.layers.enable(mountLayer(c.id));
}

export class CameraMountsView {
  readonly group = new THREE.Group();

  constructor(cfg: LineConfig, models: Models) {
    for (const cam of CAMERAS) this.group.add(buildMount(cfg, cam, models.camera_mount));
    this.group.updateMatrixWorld(true);
  }
}

function part(model: THREE.Object3D, name: string): THREE.Object3D {
  const o = model.getObjectByName(name);
  if (!o) throw new Error(`camera_mount.glb has no ${name}`);
  return o.clone();
}

/** Position of a marker empty in its part's own coordinates. */
function marker(partRoot: THREE.Object3D, name: string): THREE.Vector3 {
  const o = partRoot.getObjectByName(name);
  if (!o) throw new Error(`camera_mount.glb has no ${name}`);
  return o.position.clone();
}

function buildMount(cfg: LineConfig, cam: CameraDef, model: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.name = `mount-${cam.id}`;
  const { position: eye, target } = cameraPose(cfg, cam);
  const tableY = BELT_Y + TABLE;

  // The head takes the camera's pose (the model looks along -Z, as a three.js camera does).
  const head = part(model, 'cam_head');
  head.position.copy(eye);
  head.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, target, new THREE.Vector3(0, 1, 0)));
  g.add(head);
  head.updateMatrixWorld(true);
  const pivot = head.localToWorld(marker(head, 'cam_pivot'));
  const cableOut = head.localToWorld(marker(head, 'cam_cable'));

  // Clamp, post and foot stand upright, turned to face where the camera looks.
  const forward = target.clone().sub(eye).setY(0).normalize();
  const yaw = Math.atan2(-forward.x, -forward.z);
  const clamp = part(model, 'cam_clamp');
  clamp.position.copy(pivot);
  clamp.rotation.y = yaw;
  const foot = part(model, 'cam_foot');
  foot.position.set(pivot.x, tableY, pivot.z);
  foot.rotation.y = yaw;
  const postBottom = tableY + marker(foot, 'cam_post_base').y;
  const postTop = pivot.y + marker(clamp, 'cam_post_top').y;
  const post = part(model, 'cam_post');
  post.position.set(pivot.x, postBottom, pivot.z);
  post.rotation.y = yaw;
  post.scale.y = postTop - postBottom;
  g.add(clamp, foot, post);

  // Cable: from the connector behind the camera, under the clamp to the back of the post, down
  // the post and into the foot plate.
  const back = forward.clone().negate();
  const atPost = (y: number) => new THREE.Vector3(pivot.x, y, pivot.z).addScaledVector(back, POST_HALF + CABLE_R);
  const clampBottom = postTop - 0.01;
  const curve = new THREE.CatmullRomCurve3(
    [
      cableOut,
      cableOut.clone().add(new THREE.Vector3(0, -0.015, 0)),
      atPost(clampBottom - 0.016).addScaledVector(back, 0.025),
      atPost(clampBottom - 0.03),
      atPost(postBottom + 0.02),
      atPost(postBottom - 0.002),
    ],
    false,
    'centripetal',
  );
  const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, CABLE_R, 8, false), cableMat);
  cable.castShadow = true;
  g.add(cable);

  const layer = mountLayer(cam.id);
  g.traverse((o) => o.layers.set(layer));
  return g;
}
