import * as THREE from 'three';
import type { PartType } from '../sim/config';
import type { MoverFrame } from '../sim/protocol';
import type { Pose } from '../sim/track';
import { type Models, findMesh } from './models';
import { dataMatrixTexture, numberTexture } from './textures';

/** Fixture seat height on the mover (Blender: pen sits at z = 0.03). */
export const SEAT = 0.03;
/** Gripper height when placing on / picking from a mover (config layout.z.mover). */
const GRIP_AT_MOVER = 0.17;

/**
 * How far below the gripper tip each held thing's origin hangs, chosen so that a part held at
 * mover height sits exactly where it rests on the mover.
 */
export const HANG = {
  assembly: GRIP_AT_MOVER - SEAT,
  spring: GRIP_AT_MOVER - (SEAT + 0.112),
  cartridge: GRIP_AT_MOVER - (SEAT + 0.07),
  housing: GRIP_AT_MOVER - (SEAT + 0.008),
};

/** A pen in any state of assembly, origin at the body's base. */
export class AssemblyView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Object3D;
  private readonly spring: THREE.Object3D;
  private readonly cartridge: THREE.Object3D;
  private readonly pen: THREE.Object3D;
  readonly dmMaterial = new THREE.MeshStandardMaterial({ color: 0xebebe6, roughness: 0.5 });
  private key = '';

  constructor(models: Models) {
    this.body = models.pen_body.clone(true);
    const dm = findMesh(this.body, 'dm_mark');
    if (dm) dm.material = this.dmMaterial;
    this.spring = models.spring.clone(true);
    this.spring.position.y = 0.112;
    this.cartridge = models.cartridge.clone(true);
    this.cartridge.position.y = 0.07;
    this.pen = models.pen.clone(true);
    this.pen.position.y = 0.008;
    for (const o of [this.body, this.spring, this.cartridge, this.pen]) {
      o.visible = false;
      this.root.add(o);
    }
  }

  show(parts: PartType[]): void {
    const key = parts.join(',');
    if (key === this.key) return;
    this.key = key;
    const assembled = parts.includes('housing');
    this.pen.visible = assembled;
    this.body.visible = parts.includes('body') && !assembled;
    this.cartridge.visible = parts.includes('cartridge') && !assembled;
    this.spring.visible = parts.includes('spring') && !parts.includes('cartridge') && !assembled;
  }
}

/** Whatever a robot gripper holds, hung below the gripper tip (origin = tip). */
export class HeldView {
  readonly root = new THREE.Group();
  private readonly assembly: AssemblyView;
  private readonly spring: THREE.Object3D;
  private readonly cartridge: THREE.Object3D;
  private readonly housing = new THREE.Group();
  private key = '-';

  constructor(models: Models) {
    this.assembly = new AssemblyView(models);
    this.assembly.root.position.y = -HANG.assembly;
    this.spring = models.spring.clone(true);
    this.spring.position.y = -HANG.spring;
    this.cartridge = models.cartridge.clone(true);
    this.cartridge.position.y = -HANG.cartridge;
    const housing = models.housing.clone(true);
    const cap = models.cap.clone(true);
    cap.position.y = 0.12;
    this.housing.add(housing, cap);
    this.housing.position.y = -HANG.housing;
    this.root.add(this.assembly.root, this.spring, this.cartridge, this.housing);
    this.show(null);
  }

  show(parts: PartType[] | null): void {
    const key = parts ? parts.join(',') : '';
    if (key === this.key) return;
    this.key = key;
    const has = (p: PartType) => !!parts?.includes(p);
    const isPen = has('body');
    this.assembly.root.visible = isPen;
    if (isPen) this.assembly.show(parts!);
    this.spring.visible = !isPen && has('spring');
    this.cartridge.visible = !isPen && has('cartridge');
    this.housing.visible = !isPen && has('housing');
  }
}

const LED = {
  empty: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.4 }),
  ok: new THREE.MeshStandardMaterial({ color: 0x1f8f3a, emissive: 0x2bd552, emissiveIntensity: 1.2 }),
  nok: new THREE.MeshStandardMaterial({ color: 0x8f1f1f, emissive: 0xff3030, emissiveIntensity: 1.6 }),
};

export class MoverView {
  readonly root = new THREE.Group();
  private readonly assembly: AssemblyView;
  private readonly led: THREE.Mesh;
  private mark: string | null = null;

  constructor(
    readonly id: number,
    models: Models,
  ) {
    this.root.name = `mover-${id}`;
    this.root.userData.moverId = id;

    const mover = models.mover.clone(true);
    const labelMat = new THREE.MeshStandardMaterial({ map: numberTexture(id), roughness: 0.6 });
    for (const name of ['label_top', 'label_side_a', 'label_side_b']) {
      const m = findMesh(mover, name);
      if (m) m.material = labelMat;
    }
    this.root.add(mover);

    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), LED.empty);
    this.led.position.set(0.04, 0.031, 0.04);
    this.root.add(this.led);

    this.assembly = new AssemblyView(models);
    this.assembly.root.position.y = SEAT;
    this.root.add(this.assembly.root);
  }

  update(f: MoverFrame, p: Pose, height: number): void {
    this.root.position.set(p.x, height, -p.y);
    this.root.rotation.y = p.heading;
    this.led.material = LED[f.status];
    this.assembly.show(f.parts);
    if (f.mark !== this.mark) {
      this.mark = f.mark;
      const m = this.assembly.dmMaterial;
      m.map = f.mark ? dataMatrixTexture(f.mark) : null;
      m.needsUpdate = true;
    }
  }
}
