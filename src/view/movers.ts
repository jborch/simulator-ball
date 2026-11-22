import * as THREE from 'three';
import type { LineConfig, PartType } from '../sim/config';
import { heldLength } from '../sim/layout';
import type { MoverFrame } from '../sim/protocol';
import type { Pose } from '../sim/track';
import { batch } from './hardware';
import type { Models } from './models';
import { hash01 } from './scene';
import { carrierWear, dataMatrixTexture, numberTexture } from './textures';
import { varyMoulding } from './finishes';

/**
 * A housing, origin at its base (as fed and as picked). Call `showLabel` to show the label EM31
 * puts on it; a fresh housing has none.
 */
export function housingPart(models: Models): THREE.Object3D {
  const g = models.housing.clone(true);
  varyMoulding(g);
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
    if (!name.endsWith('_dm_label')) return;
    const mesh = o as THREE.Mesh;
    if (!mesh.userData.ownMaterial) {
      mesh.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.83 });
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
    varyMoulding(this.pen);
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

/** Status light pipes: dark when the carrier is empty, green with a good part, red when a step is missing (NOK). */
const LED = {
  empty: new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.18, metalness: 0.1 }),
  ok: new THREE.MeshStandardMaterial({ color: 0x2fae4e, emissive: 0x3dff6e, emissiveIntensity: 1.5, roughness: 0.2 }),
  nok: new THREE.MeshStandardMaterial({ color: 0xc02020, emissive: 0xff2b1f, emissiveIntensity: 2.6, roughness: 0.2 }),
};

/** How a visible incident changes the look of one mover (see incidents.ts). */
export interface MoverLook {
  /** Parts not drawn although the sim has them (a missing spring; everything for a lost pen). */
  hide?: PartType[];
  /** Pen leaning in its fixture, forward or back along the belt (rad). */
  tilt?: number;
  /** The mover itself skewed on the belt (rad), as when jammed. */
  skew?: number;
}

/** Placeholders the carrier template is merged with, swapped per carrier for its own plates and lights. */
const TOP_PLATE = new THREE.MeshStandardMaterial();
const SIDE_PLATE = new THREE.MeshStandardMaterial();
const LIGHT_PIPE = new THREE.MeshStandardMaterial();
const templates = new WeakMap<THREE.Object3D, THREE.Group>();

/** The carrier model merged into one mesh per finish (and one each for its plates and lights). */
function carrierTemplate(models: Models): THREE.Group {
  let t = templates.get(models.mover);
  if (!t) {
    const src = models.mover.clone(true);
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = mesh.name || mesh.parent?.name || '';
      if (name.startsWith('label_top')) mesh.material = TOP_PLATE;
      else if (name.startsWith('label_side')) mesh.material = SIDE_PLATE;
      else if (name.startsWith('status_led')) mesh.material = LIGHT_PIPE;
    });
    t = new THREE.Group();
    t.add(src);
    batch(t);
    templates.set(models.mover, t);
  }
  return t;
}

/** A blurred square: the carriers' contact shadow (their footprint fills 70 % of the patch). */
let shadowMat: THREE.MeshBasicMaterial | null = null;
function footprintShadow(): THREE.MeshBasicMaterial {
  if (shadowMat) return shadowMat;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.filter = 'blur(7px)';
  g.fillStyle = 'rgba(8,10,10,0.78)';
  g.beginPath();
  g.roundRect(19, 19, 90, 90, 8);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  shadowMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return shadowMat;
}

export class MoverView {
  readonly root = new THREE.Group();
  private readonly assembly: AssemblyView;
  private readonly leds: THREE.Mesh[] = [];
  /** The model's own materials, before wear. */
  private readonly baseMaterials = new Map<THREE.Mesh, THREE.MeshStandardMaterial>();
  look: MoverLook | null = null;
  /**
   * Soft contact shadow round the carrier's footprint on the belt. Kept out of `root`, whose
   * bounds are the carrier's ground-truth box (oracle.ts); the line adds it beside the root.
   */
  readonly shadow: THREE.Mesh;

  constructor(
    readonly id: number,
    cfg: LineConfig,
    models: Models,
  ) {
    this.root.name = `mover-${id}`;
    this.root.userData.moverId = id;
    this.root.userData.track = { cls: 'mover', id: `mover-${id}` };

    const mover = carrierTemplate(models).clone(true);
    // Laminated ID plates, printed at their own aspect so the digits keep their shape.
    const sideMat = new THREE.MeshStandardMaterial({ map: numberTexture(id, 52 / 18.5), roughness: 0.42 });
    const topMat = new THREE.MeshStandardMaterial({ map: numberTexture(id, 46 / 22, true), roughness: 0.42 });
    mover.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.material === TOP_PLATE) mesh.material = topMat;
      else if (mesh.material === SIDE_PLATE) mesh.material = sideMat;
      else if (mesh.material === LIGHT_PIPE) {
        this.leds.push(mesh);
        mesh.castShadow = false;
      } else this.baseMaterials.set(mesh, mesh.material as THREE.MeshStandardMaterial);
    });
    this.root.add(mover);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(cfg.mover.length + 0.05, cfg.mover.length + 0.05).rotateX(-Math.PI / 2), footprintShadow());
    this.shadow.renderOrder = -1;

    this.assembly = new AssemblyView(cfg, models);
    this.assembly.root.position.y = cfg.mover.seat;
    this.root.add(this.assembly.root);
  }

  /**
   * Each mover has seen different use: a slightly different colour and finish, and some are worn
   * (duller, darker, with a scuffed top). Derived from the scene seed, so every camera agrees.
   */
  setWear(seed: number): void {
    const h = (k: number) => hash01(seed, this.id, 9100 + k);
    const worn = h(0) < 0.3 ? 0.5 + 0.5 * h(1) : 0.15 * h(1);
    for (const [mesh, base] of this.baseMaterials) {
      const m = base.clone();
      const hsl = { h: 0, s: 0, l: 0 };
      m.color.getHSL(hsl);
      m.color.setHSL(hsl.h + (h(2) - 0.5) * 0.02, Math.max(0, hsl.s * (1 - 0.35 * worn) + (h(3) - 0.5) * 0.06), Math.max(0, hsl.l * (1 - 0.25 * worn) + (h(4) - 0.5) * 0.04));
      m.roughness = Math.min(1, base.roughness + 0.3 * worn);
      m.metalness = base.metalness * (1 - 0.5 * worn);
      // Worn carriers carry grime and scuffs on their body and tooling plate.
      if (worn > 0.4 && (base.name === 'MoverBody' || base.name === 'ToolPlate')) {
        const w = carrierWear();
        m.map = w.map;
        m.roughnessMap = w.rough;
      }
      const old = mesh.material as THREE.Material;
      mesh.material = m;
      if (old !== base) old.dispose();
    }
  }

  update(f: MoverFrame, p: Pose, height: number): void {
    this.root.position.set(p.x, height, -p.y);
    const look = this.look;
    this.root.rotation.y = p.heading + (look?.skew ?? 0);
    this.shadow.position.set(this.root.position.x, height + 0.0004, this.root.position.z);
    this.shadow.rotation.y = this.root.rotation.y;
    for (const led of this.leds) led.material = LED[f.status];
    this.assembly.show(look?.hide ? f.parts.filter((x) => !look.hide!.includes(x)) : f.parts);
    this.assembly.setMark(look?.hide?.includes('housing') ? null : f.mark);
    // Leaning along the belt (as the station cameras, looking across it, see best), pivoting on
    // the fixture seat.
    this.assembly.root.rotation.z = look?.tilt ?? 0;
  }
}
