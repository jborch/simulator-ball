// Views of station equipment, each drawn in its station's local coordinates from frame data.
import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { nestPocket, trayPocket } from '../sim/layout';
import type { RobotFrame } from '../sim/protocol';
import { M, RAIL_Y, type Reach, TABLE, box, cyl, label, local, mat, span } from './build';
import type { Models } from './models';
import { HANG, HeldView } from './movers';

/** Cartesian gantry robot: a-axis bridge on two rails, r-axis carriage, z-axis column with gripper. */
export class RobotView {
  readonly group = new THREE.Group();
  private readonly bridge = new THREE.Group();
  private readonly carriage = new THREE.Group();
  private readonly column = new THREE.Group();
  private readonly held: HeldView;
  private readonly laser: THREE.Mesh | null = null;
  private readonly fingers: THREE.Mesh[] = [];

  constructor(reach: Reach, models: Models, withLaser: boolean) {
    const { aMin, aMax, rMin, rMax } = reach;
    for (const r of [rMin, rMax]) {
      this.group.add(span(aMin, aMax, RAIL_Y - 0.015, RAIL_Y + 0.015, r - 0.015, r + 0.015, M.rail));
      for (const a of [aMin, aMax]) this.group.add(span(a - 0.015, a + 0.015, TABLE, RAIL_Y - 0.015, r - 0.015, r + 0.015, M.frame));
    }
    this.bridge.add(span(-0.02, 0.02, RAIL_Y + 0.015, RAIL_Y + 0.05, rMin - 0.02, rMax + 0.02, M.axis));
    this.carriage.add(span(-0.035, 0.035, RAIL_Y, RAIL_Y + 0.07, -0.03, 0.03, M.axisDark));
    // Column space: y = 0 is the gripper tip.
    this.column.add(span(-0.012, 0.012, 0.03, 0.34, -0.012, 0.012, M.rail));
    this.column.add(span(-0.02, 0.02, 0.018, 0.035, -0.02, 0.02, M.axisDark));
    for (const r of [-0.011, 0.011]) {
      const f = span(-0.004, 0.004, 0, 0.02, r - 0.003, r + 0.003, M.frame);
      this.fingers.push(f);
      this.column.add(f);
    }
    this.held = new HeldView(models);
    this.column.add(this.held.root);
    this.carriage.add(this.column);
    this.bridge.add(this.carriage);
    this.group.add(this.bridge);

    if (withLaser) {
      // Fixed laser head on the inner rail side, beam angled down onto the pen in the fixture.
      this.group.add(span(-0.03, 0.03, 0.3, 0.36, rMin + 0.01, rMin + 0.07, M.camera));
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.26, 6), M.laser);
      beam.position.copy(local(0, 0.18, rMin / 2 + 0.02));
      beam.rotation.x = -0.32;
      beam.visible = false;
      this.laser = beam;
      this.group.add(beam);
    }
  }

  update(r: RobotFrame): void {
    this.bridge.position.x = r.a;
    this.carriage.position.z = -r.r;
    this.column.position.y = r.z;
    this.held.show(r.holding);
    const open = r.holding ? 0 : 0.004;
    this.fingers[0].position.z = 0.011 + open;
    this.fingers[1].position.z = -0.011 - open;
    if (this.laser) this.laser.visible = r.phase === 'laser';
  }
}

/** Inspection camera on a small bridge over the belt. Returns the camera to animate. */
export function cameraGantry(group: THREE.Group): THREE.Object3D {
  const postH = 0.42;
  for (const r of [-0.12, 0.12]) group.add(span(-0.015, 0.015, TABLE, postH, r - 0.015, r + 0.015, M.frame));
  group.add(span(-0.025, 0.025, postH - 0.02, postH + 0.02, -0.14, 0.14, M.frame));
  const cam = new THREE.Group();
  const body = box(0.05, 0.07, 0.05, M.camera);
  const lens = cyl(0.014, 0.03, M.lens);
  lens.position.y = -0.045;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 24), mat(0xffffff, { emissive: 0xbfe3ff, emissiveIntensity: 0.6 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.065;
  cam.add(body, lens, ring);
  cam.position.y = postH - 0.1;
  group.add(cam);
  return cam;
}

/** Bowl feeder on a stand, with parts queueing on its linear track. */
export class FeederView {
  readonly group = new THREE.Group();
  private readonly pool: THREE.Object3D[] = [];
  private readonly feederR: number;
  private readonly bowlMat = M.bowl.clone();
  private readonly tag: HTMLElement;
  private readonly name: string;

  constructor(
    readonly id: string,
    cfg: LineConfig,
    models: Models,
  ) {
    const def = cfg.feeders.find((f) => f.id === id)!;
    this.feederR = cfg.layout.feederR;
    const hang = def.part === 'body' ? HANG.assembly : def.part === 'spring' ? HANG.spring : HANG.housing;
    const trackY = def.pickZ - hang;
    const r0 = this.feederR - 0.02;
    const r1 = this.feederR + def.track;
    this.group.add(span(-0.02, 0.02, trackY - 0.01, trackY, r0, r1, M.rail));
    this.group.add(span(-0.022, -0.018, trackY, trackY + 0.015, r0, r1, M.rail));
    this.group.add(span(0.018, 0.022, trackY, trackY + 0.015, r0, r1, M.rail));
    this.group.add(span(-0.015, 0.015, TABLE, trackY - 0.01, r1 - 0.05, r1 - 0.02, M.frame));
    this.group.add(span(-0.015, 0.015, TABLE, trackY - 0.01, r0 + 0.01, r0 + 0.04, M.frame));

    const bowlR = r1 + 0.13;
    const bowlY = trackY + 0.02;
    const base = cyl(0.07, bowlY - 0.04 - TABLE, M.frame);
    base.position.copy(local(0, (TABLE + bowlY - 0.04) / 2, bowlR));
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.07, 0.08, 32, 1, true), this.bowlMat);
    bowl.position.copy(local(0, bowlY, bowlR));
    bowl.castShadow = true;
    this.group.add(base, bowl);
    const names: Record<string, string> = { body: 'Pen bodies', spring: 'Springs', housing: 'Housings + caps' };
    this.name = names[def.part] ?? def.id;
    const l = label(this.name, 'label feeder');
    l.position.copy(local(0, bowlY + 0.12, bowlR));
    this.tag = l.element;
    this.group.add(l);

    const make = (): THREE.Object3D => {
      if (def.part === 'body') return models.pen_body.clone(true);
      if (def.part === 'spring') return models.spring.clone(true);
      const g = new THREE.Group();
      const cap = models.cap.clone(true);
      cap.position.y = 0.12;
      g.add(models.housing.clone(true), cap);
      return g;
    };
    const n = Math.ceil(def.track / def.pitch) + 1;
    for (let i = 0; i < n; i++) {
      const o = make();
      o.position.y = trackY;
      o.visible = false;
      this.pool.push(o);
      this.group.add(o);
    }
  }

  update(items: number[], jam: number, t: number): void {
    this.pool.forEach((o, i) => {
      o.visible = i < items.length;
      if (o.visible) o.position.z = -(this.feederR + items[i]);
    });
    const jammed = jam > 0;
    this.tag.classList.toggle('jam', jammed);
    this.tag.textContent = jammed ? `${this.name}: JAM (${Math.ceil(jam)} s)` : this.name;
    const flash = jammed && Math.floor(t * 3) % 2 === 0;
    this.bowlMat.emissive.setHex(flash ? 0xc01818 : 0x000000);
    this.bowlMat.emissiveIntensity = flash ? 0.8 : 0;
  }
}

export class NestView {
  readonly group = new THREE.Group();
  private readonly moving = new THREE.Group();
  private readonly carts: THREE.Object3D[] = [];

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const n = cfg.layout.nest;
    const w = n.cols * n.pitch + 0.012;
    const d = n.rows * n.pitch + 0.012;
    // Fixed stand, and the nest plate with cartridges that slides out for a nest change.
    this.group.add(span(n.a - w / 2, n.a + w / 2, TABLE, -0.008, n.r - d / 2, n.r + d / 2 + 0.3, M.frame));
    this.moving.add(span(n.a - w / 2, n.a + w / 2, -0.008, 0, n.r - d / 2, n.r + d / 2, M.nest));
    for (let i = 0; i < cfg.nestSize; i++) {
      const c = models.cartridge.clone(true);
      const p = nestPocket(cfg, i);
      c.position.copy(local(p.a, 0, p.r));
      this.carts.push(c);
      this.moving.add(c);
    }
    this.group.add(this.moving);
    const l = label('Cartridge nest', 'label feeder');
    l.position.copy(local(n.a, 0.16, n.r + 0.1));
    this.group.add(l);
  }

  update(slots: number[], changing: number): void {
    const progress = changing > 0 ? 1 - changing / this.cfg.nestChange : 0;
    const out = changing > 0 ? (progress < 0.5 ? progress : 1 - progress) * 0.5 : 0;
    this.moving.position.z = -out;
    // Out goes the empty nest, back comes a full one.
    this.carts.forEach((c, i) => (c.visible = changing > 0 ? progress >= 0.5 : slots[i] !== 0));
  }
}

export class TrayView {
  readonly group = new THREE.Group();
  private readonly moving = new THREE.Group();
  private readonly pens: THREE.Object3D[] = [];
  private readonly stack: THREE.Object3D[] = [];
  private readonly stackLabel: HTMLElement;

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const t = cfg.layout.tray;
    const penY = cfg.layout.z.tray - HANG.housing;
    // Tray conveyor under the tray, running along +a to the stack of finished trays.
    this.group.add(span(t.a - 0.08, t.a + 0.42, TABLE, penY - 0.016, t.r - 0.06, t.r + 0.06, M.frame));
    const tray = models.tray.clone(true);
    tray.position.copy(local(t.a, penY - 0.016, t.r));
    this.moving.add(tray);
    for (let i = 0; i < cfg.traySize; i++) {
      const pen = models.pen.clone(true);
      const p = trayPocket(cfg, i);
      pen.position.copy(local(p.a, penY, p.r));
      pen.visible = false;
      this.pens.push(pen);
      this.moving.add(pen);
    }
    this.group.add(this.moving);
    for (let i = 0; i < 10; i++) {
      const s = models.tray.clone(true);
      s.position.copy(local(t.a + 0.34, penY - 0.016 + i * 0.022, t.r));
      s.visible = false;
      this.stack.push(s);
      this.group.add(s);
    }
    const l = label('Trays out: 0', 'label feeder');
    l.position.copy(local(t.a + 0.34, 0.3, t.r));
    this.stackLabel = l.element;
    this.group.add(l);
  }

  update(count: number, changing: number, traysOut: number): void {
    // A full tray slides out toward the stack, then an empty one slides in.
    const progress = changing > 0 ? 1 - changing / this.cfg.trayChange : 0;
    this.moving.position.x = changing > 0 ? (progress < 0.5 ? progress : 1 - progress) * 0.6 : 0;
    const shown = changing > 0 && progress >= 0.5 ? 0 : count;
    this.pens.forEach((p, i) => (p.visible = i < shown));
    this.stack.forEach((s, i) => (s.visible = i < Math.min(traysOut, this.stack.length)));
    this.stackLabel.textContent = `Trays out: ${traysOut}`;
  }
}

/** A bin that visibly fills up with rejected pens. */
export class BinView {
  readonly group = new THREE.Group();
  private shown = 0;
  private readonly countLabel: HTMLElement;

  constructor(
    private readonly name: string,
    private readonly pen: THREE.Object3D,
  ) {
    const w = 0.24;
    const d = 0.2;
    const h = 0.16;
    this.group.add(span(-w / 2, w / 2, 0, 0.01, -d / 2, d / 2, M.bin));
    this.group.add(span(-w / 2, w / 2, 0, h, d / 2 - 0.01, d / 2, M.bin));
    this.group.add(span(-w / 2, w / 2, 0, h, -d / 2, -d / 2 + 0.01, M.bin));
    this.group.add(span(w / 2 - 0.01, w / 2, 0, h, -d / 2, d / 2, M.bin));
    this.group.add(span(-w / 2, -w / 2 + 0.01, 0, h, -d / 2, d / 2, M.bin));
    const l = label(`${name}: 0`, 'label bin');
    l.position.y = h + 0.08;
    this.countLabel = l.element;
    this.group.add(l);
  }

  setCount(n: number): void {
    this.countLabel.textContent = `${this.name}: ${n}`;
    const target = Math.min(n, 40);
    while (this.shown < target) {
      // Pen origin is at its end; centre it so it lies inside the bin.
      const pen = this.pen.clone(true);
      pen.position.y = -0.08;
      const p = new THREE.Group();
      p.add(pen);
      // Deterministic scatter so every viewer sees the same pile.
      const i = this.shown;
      const r = (k: number) => (((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1) + 1) % 1;
      p.rotation.set(Math.PI / 2, 0, (r(1) - 0.5) * 1.2);
      p.position.set((r(2) - 0.5) * 0.06, 0.02 + Math.floor(i / 8) * 0.017, (r(3) - 0.5) * 0.1);
      this.group.add(p);
      this.shown++;
    }
  }
}

/** Parts dropped at a station, lying on the table beside the belt. */
export class ScrapView {
  readonly group = new THREE.Group();
  private shown = 0;

  constructor(private readonly part: THREE.Object3D) {}

  setCount(n: number): void {
    const target = Math.min(n, 15);
    while (this.shown < target) {
      const i = this.shown++;
      const r = (k: number) => (((Math.sin((i + 7) * 91.17 + k * 47.3) * 24634.6345) % 1) + 1) % 1;
      const o = this.part.clone(true);
      o.rotation.set(Math.PI / 2, 0, r(1) * Math.PI * 2);
      o.position.copy(local((r(2) - 0.5) * 0.2, TABLE + 0.008, 0.12 + r(3) * 0.1));
      this.group.add(o);
    }
  }
}
