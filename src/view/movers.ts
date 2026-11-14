import * as THREE from 'three';
import type { MoverFrame } from '../sim/protocol';
import type { Pose } from '../sim/track';
import { type Models, findMesh } from './models';
import { dataMatrixTexture, numberTexture } from './textures';

/** Fixture seat height on the mover (Blender: pen sits at z = 0.03). */
const SEAT = 0.03;

const LED = {
  empty: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.4 }),
  ok: new THREE.MeshStandardMaterial({ color: 0x1f8f3a, emissive: 0x2bd552, emissiveIntensity: 1.2 }),
  nok: new THREE.MeshStandardMaterial({ color: 0x8f1f1f, emissive: 0xff3030, emissiveIntensity: 1.6 }),
};

export class MoverView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Object3D;
  private readonly spring: THREE.Object3D;
  private readonly cartridge: THREE.Object3D;
  private readonly pen: THREE.Object3D;
  private readonly led: THREE.Mesh;
  private readonly dmMaterial: THREE.MeshStandardMaterial;
  private mark: string | null = null;
  private partsKey = '';

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

    this.body = models.pen_body.clone(true);
    this.body.position.y = SEAT;
    this.dmMaterial = new THREE.MeshStandardMaterial({ color: 0xebebe6, roughness: 0.5 });
    const dm = findMesh(this.body, 'dm_mark');
    if (dm) dm.material = this.dmMaterial;

    this.spring = models.spring.clone(true);
    this.spring.position.y = SEAT + 0.112;
    this.cartridge = models.cartridge.clone(true);
    this.cartridge.position.y = SEAT + 0.07;
    this.pen = models.pen.clone(true);
    this.pen.position.y = SEAT + 0.008;
    for (const o of [this.body, this.spring, this.cartridge, this.pen]) {
      o.visible = false;
      this.root.add(o);
    }
  }

  update(f: MoverFrame, p: Pose, height: number): void {
    this.root.position.set(p.x, height, -p.y);
    this.root.rotation.y = p.heading;
    this.led.material = LED[f.status];

    const key = f.parts.join(',');
    if (key !== this.partsKey) {
      this.partsKey = key;
      const has = (x: string) => f.parts.includes(x as never);
      const assembled = has('housing');
      this.pen.visible = assembled;
      this.body.visible = has('body') && !assembled;
      this.cartridge.visible = has('cartridge') && !assembled;
      this.spring.visible = has('spring') && !has('cartridge') && !assembled;
    }

    if (f.mark !== this.mark) {
      this.mark = f.mark;
      this.dmMaterial.map = f.mark ? dataMatrixTexture(f.mark) : null;
      this.dmMaterial.needsUpdate = true;
    }
  }
}
