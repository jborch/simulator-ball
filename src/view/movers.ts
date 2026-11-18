import * as THREE from 'three';
import type { LineConfig, PartType } from '../sim/config';
import { heldLength } from '../sim/layout';
import type { MoverFrame } from '../sim/protocol';
import type { Pose } from '../sim/track';
import { type Models, findMesh } from './models';
import { dataMatrixTexture, numberTexture } from './textures';

/**
 * A housing, origin at its base (as fed and as picked). Call `showLabel` to show the label EM31
 * puts on it; a fresh housing has none.
 */
export function housingPart(models: Models): THREE.Object3D {
  const g = models.housing.clone(true);
  showLabel(g, null);
  return g;
}

/**
 * Shows or hides the wrap label on a housing (or a finished pen) and paints the label's
 * DataMatrix with `gs1`. Each object gets its own code material the first time.
 */
export function showLabel(root: THREE.Object3D, gs1: string | null): void {
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const name = o.name || o.parent?.name || '';
    if (!name.endsWith('_label')) return;
    o.visible = gs1 !== null;
    if (name !== 'dm_label' && o.parent?.name !== 'dm_label') return;
    const mesh = o as THREE.Mesh;
    if (!mesh.userData.ownMaterial) {
      mesh.material = new THREE.MeshStandardMaterial({ color: 0xebebe6, roughness: 0.5 });
      mesh.userData.ownMaterial = true;
    }
    const m = mesh.material as THREE.MeshStandardMaterial;
    const map = gs1 ? dataMatrixTexture(gs1) : null;
    if (m.map !== map) {
      m.map = map;
      m.needsUpdate = true;
    }
  });
}

/** A pen in any state of assembly, origin at the body's base. */
export class AssemblyView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Object3D;
  private readonly spring: THREE.Object3D;
  private readonly springBase: THREE.Object3D;
  private readonly cartridge: THREE.Object3D;
  private readonly pen: THREE.Object3D;
  private key = '';
  private mark: string | null = null;

  constructor(cfg: LineConfig, models: Models) {
    const at = (o: THREE.Object3D, part: PartType) => {
      o.position.y = cfg.parts[part].seat;
      return o;
    };
    this.body = models.pen_body.clone(true);
    this.spring = at(models.spring.clone(true), 'spring');
    this.springBase = at(models.spring_base.clone(true), 'springBase');
    this.cartridge = at(models.cartridge.clone(true), 'cartridge');
    // The finished-pen model is the labelled housing with its cap; the body stays inside it.
    this.pen = at(models.pen.clone(true), 'housing');
    showLabel(this.pen, null);
    for (const o of [this.body, this.spring, this.springBase, this.cartridge, this.pen]) {
      o.visible = false;
      this.root.add(o);
    }
  }

  show(parts: PartType[]): void {
    const key = parts.join(',');
    if (key === this.key) return;
    this.key = key;
    // Every part is drawn where it sits: the spring, spring base and cartridge show through the
    // translucent body.
    this.pen.visible = parts.includes('housing');
    this.body.visible = parts.includes('body');
    this.cartridge.visible = parts.includes('cartridge');
    this.spring.visible = parts.includes('spring');
    this.springBase.visible = parts.includes('springBase');
  }

  /** The identifier printed on the pen's housing label (null while it has none). */
  setMark(mark: string | null): void {
    if (mark === this.mark) return;
    this.mark = mark;
    showLabel(this.pen, mark);
  }
}

/** Whatever a robot gripper holds, held by its top at the gripper tip (origin = tip). */
export class HeldView {
  readonly root = new THREE.Group();
  private readonly assembly: AssemblyView;
  private readonly spring: THREE.Object3D;
  private readonly springBase: THREE.Object3D;
  private readonly cartridge: THREE.Object3D;
  private readonly housing = new THREE.Group();
  private key = '-';

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    this.assembly = new AssemblyView(cfg, models);
    this.spring = models.spring.clone(true);
    this.spring.position.y = -heldLength(cfg, ['spring']);
    this.springBase = models.spring_base.clone(true);
    this.springBase.position.y = -heldLength(cfg, ['springBase']);
    this.cartridge = models.cartridge.clone(true);
    this.cartridge.position.y = -heldLength(cfg, ['cartridge']);
    this.housing.add(housingPart(models));
    this.housing.position.y = -heldLength(cfg, ['housing']);
    this.root.add(this.assembly.root, this.spring, this.springBase, this.cartridge, this.housing);
    this.show(null);
  }

  /** `label`: what is printed on the held housing or pen, if anything. */
  show(parts: PartType[] | null, label: string | null = null): void {
    const key = parts ? `${parts.join(',')}|${label ?? ''}` : '';
    if (key === this.key) return;
    this.key = key;
    const has = (p: PartType) => !!parts?.includes(p);
    const isPen = has('body');
    this.assembly.root.visible = isPen;
    if (isPen) {
      this.assembly.show(parts!);
      this.assembly.setMark(label);
      this.assembly.root.position.y = -heldLength(this.cfg, parts!);
    } else if (has('housing')) {
      showLabel(this.housing, label);
    }
    this.spring.visible = !isPen && has('spring');
    this.springBase.visible = !isPen && has('springBase');
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

  constructor(
    readonly id: number,
    cfg: LineConfig,
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

    this.assembly = new AssemblyView(cfg, models);
    this.assembly.root.position.y = cfg.mover.seat;
    this.root.add(this.assembly.root);
  }

  update(f: MoverFrame, p: Pose, height: number): void {
    this.root.position.set(p.x, height, -p.y);
    this.root.rotation.y = p.heading;
    this.led.material = LED[f.status];
    this.assembly.show(f.parts);
    this.assembly.setMark(f.mark);
  }
}
