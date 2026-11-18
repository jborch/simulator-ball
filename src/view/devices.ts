// Views of station equipment, each drawn in its station's local coordinates from frame data.
import * as THREE from 'three';
import type { FeederDef, LineConfig, PartType } from '../sim/config';
import { gripRadius, heldLength, trayPocket } from '../sim/layout';
import type { RobotFrame } from '../sim/protocol';
import { M, RAIL_Y, type Reach, TABLE, box, cyl, label, local, mat, span } from './build';
import type { Models } from './models';
import { AssemblyView, HeldView, housingPart } from './movers';

/** One arm of a gantry: travels along the beam (a), with a carriage (r) and a z column with the gripper. */
class ArmView {
  readonly arm = new THREE.Group();
  private readonly carriage = new THREE.Group();
  private readonly column = new THREE.Group();
  private readonly held: HeldView;
  private readonly fingers: THREE.Mesh[] = [];

  constructor(
    rMin: number,
    beamR: number,
    lowestTip: number,
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const top = RAIL_Y + 0.02;
    // Arm (moves along a) with the r-axis rail underneath.
    this.arm.add(span(-0.03, 0.03, top, top + 0.03, beamR - 0.035, beamR + 0.035, M.axisDark));
    this.arm.add(span(-0.018, 0.018, top + 0.005, top + 0.045, rMin - 0.02, beamR + 0.02, M.axis));
    this.carriage.add(span(-0.03, 0.03, RAIL_Y - 0.01, top + 0.005, -0.028, 0.028, M.axisDark));
    // Column space: y = 0 is the gripper tip. Long enough to stay in the carriage at its lowest.
    this.column.add(span(-0.011, 0.011, 0.035, top + 0.02 - lowestTip, -0.011, 0.011, M.rail));
    this.column.add(span(-0.018, 0.018, 0.02, 0.04, -0.018, 0.018, M.axisDark));
    for (let i = 0; i < 2; i++) {
      const f = span(-0.004, 0.004, -0.004, 0.022, -0.0025, 0.0025, M.frame);
      this.fingers.push(f);
      this.column.add(f);
    }
    this.held = new HeldView(cfg, models);
    this.column.add(this.held.root);
    this.carriage.add(this.column);
    this.arm.add(this.carriage);
  }

  update(r: RobotFrame): void {
    this.arm.position.x = r.a;
    this.carriage.position.z = -r.r;
    this.column.position.y = r.z;
    this.held.show(r.holding, r.label);
    // Jaws close on the held part's top; open a few mm wider when empty.
    const half = r.holding ? gripRadius(this.cfg, r.holding) + 0.0025 : 0.014;
    this.fingers[0].position.z = half;
    this.fingers[1].position.z = -half;
  }
}

/**
 * Cartesian robots on a single-sided gantry: a beam on two legs behind the station's equipment
 * (outer side), with one arm per robot cantilevered over the belt and travelling along the beam.
 * Several arms share the beam and take turns over the mover. Nothing stands between the belt and
 * the viewer.
 */
export class RobotView {
  readonly group = new THREE.Group();
  private readonly arms: ArmView[];
  private readonly laser: THREE.Mesh | null = null;

  /**
   * `beamR`: where the beam and its legs stand, outside everything on the table below the robots.
   * `lowestTip`: the lowest gripper height the robots go to; the z columns stay in their carriage there.
   */
  constructor(reach: Reach, beamR: number, lowestTip: number, cfg: LineConfig, models: Models, arms: number, withLaser: boolean) {
    const { aMin, aMax, rMin } = reach;
    const top = RAIL_Y + 0.02;
    this.group.add(span(aMin - 0.03, aMax + 0.03, top - 0.05, top, beamR - 0.025, beamR + 0.025, M.frame));
    this.group.add(span(aMin - 0.03, aMax + 0.03, top - 0.012, top, beamR - 0.03, beamR - 0.02, M.rail));
    for (const a of [aMin - 0.01, aMax + 0.01]) {
      this.group.add(span(a - 0.02, a + 0.02, TABLE, top - 0.05, beamR - 0.02, beamR + 0.02, M.frame));
      this.group.add(span(a - 0.035, a + 0.035, TABLE, TABLE + 0.008, beamR - 0.035, beamR + 0.035, M.drive));
    }
    this.arms = Array.from({ length: arms }, () => {
      const arm = new ArmView(rMin, beamR, lowestTip, cfg, models);
      this.group.add(arm.arm);
      return arm;
    });

    if (withLaser) {
      // Marking head beside the belt on the inner side, where the pen's code faces.
      const head = new THREE.Group();
      head.add(span(-0.03, 0.03, 0, 0.05, -0.04, 0.04, M.camera));
      const nozzle = cyl(0.01, 0.025, M.lens);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.copy(local(0, 0.025, 0.05));
      head.add(nozzle);
      head.position.copy(local(0, cfg.mover.seat + 0.02, rMin - 0.09));
      this.group.add(head, span(-0.015, 0.015, TABLE, cfg.mover.seat + 0.02, rMin - 0.105, rMin - 0.075, M.frame));
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.09, 6), M.laser);
      beam.rotation.x = Math.PI / 2;
      beam.position.copy(local(0, cfg.mover.seat + cfg.parts.body.length * 0.41, rMin - 0.01));
      beam.visible = false;
      this.laser = beam;
      this.group.add(beam);
    }
  }

  update(robots: RobotFrame[], laser: boolean): void {
    robots.forEach((r, i) => this.arms[i]?.update(r));
    if (this.laser) this.laser.visible = laser;
  }
}

/**
 * Inspection camera with a ring light on a cantilever over the belt. `sideReader` adds a code
 * reader beside the belt aimed at the side of the pen where the DataMatrix faces.
 */
export class InspectionView {
  readonly group = new THREE.Group();
  private readonly lights: THREE.MeshStandardMaterial[] = [];

  constructor(cfg: LineConfig, sideReader: boolean) {
    const postR = 0.2;
    const top = 0.42;
    this.group.add(span(-0.018, 0.018, TABLE, top, postR - 0.018, postR + 0.018, M.frame));
    this.group.add(span(-0.035, 0.035, TABLE, TABLE + 0.008, postR - 0.035, postR + 0.035, M.drive));
    this.group.add(span(-0.02, 0.02, top - 0.03, top + 0.01, -0.03, postR + 0.02, M.frame));
    const cam = this.camera(0.07);
    cam.position.copy(local(0, top - 0.07, 0));
    this.group.add(cam);
    if (sideReader) {
      const h = cfg.mover.seat + cfg.parts.body.length * 0.41;
      const r = -0.15;
      this.group.add(span(-0.012, 0.012, TABLE, h - 0.02, r - 0.012, r + 0.012, M.frame));
      const reader = this.camera(0.05);
      reader.rotation.x = Math.PI / 2; // look outward (+r) at the pen's side
      reader.position.copy(local(0, h, r));
      this.group.add(reader);
    }
  }

  /** Camera body pointing down its local -y, with lens and ring light. */
  private camera(size: number): THREE.Group {
    const g = new THREE.Group();
    g.add(box(size * 0.7, size, size * 0.7, M.camera));
    const lens = cyl(size * 0.2, size * 0.4, M.lens);
    lens.position.y = -size * 0.65;
    const ringMat = mat(0xffffff, { emissive: 0xbfe3ff, emissiveIntensity: 0.2 });
    this.lights.push(ringMat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 0.38, size * 0.07, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -size * 0.85;
    g.add(lens, ring);
    return g;
  }

  /** Ring lights flash while the camera is exposing. */
  update(inspecting: boolean, t: number): void {
    const on = inspecting && Math.floor(t * 8) % 2 === 0;
    for (const m of this.lights) m.emissiveIntensity = on ? 2.5 : 0.2;
  }
}

/** Vibratory bowl feeder: drive base, stepped bowl with a spiral track, and a linear track to the pick point. */
export class FeederView {
  readonly group = new THREE.Group();
  private readonly pool: THREE.Object3D[] = [];
  private readonly feederR: number;
  private readonly bowlMat = M.bowl.clone();
  /** Loose parts in the bowl; they circulate while the feeder runs. */
  private readonly bulk = new THREE.Group();
  private readonly tag: HTMLElement;
  private readonly name: string;
  private lastT = 0;
  /** Inline check (EM10): ring light that flashes as a part passes the camera, and the chute count. */
  private readonly inline: { at: number; ring: THREE.MeshStandardMaterial; count: HTMLElement; id: string } | null = null;

  /** `parts`: what the robot picks from this feeder (as the station places it). */
  constructor(
    readonly id: string,
    parts: PartType[],
    cfg: LineConfig,
    models: Models,
  ) {
    const def = cfg.feeders.find((f) => f.id === id)!;
    this.feederR = def.r ?? cfg.layout.feederR;
    // Parts queue on the track at the height the gripper takes them from.
    const trackY = def.pickZ - heldLength(cfg, parts);
    const r0 = this.feederR - 0.02;
    const r1 = this.feederR + def.track;

    // Linear track: a guide channel on a vibratory drive block, with a stop at the pick end.
    this.group.add(span(-0.02, 0.02, trackY - 0.008, trackY, r0, r1, M.rail));
    this.group.add(span(-0.022, -0.017, trackY, trackY + 0.012, r0, r1, M.rail));
    this.group.add(span(0.017, 0.022, trackY, trackY + 0.012, r0, r1, M.rail));
    this.group.add(span(-0.02, 0.02, trackY, trackY + 0.02, r0 - 0.008, r0, M.frame));
    this.group.add(span(-0.025, 0.025, trackY - 0.05, trackY - 0.008, r0 + 0.03, r1 - 0.03, M.drive));
    this.group.add(span(-0.012, 0.012, TABLE, trackY - 0.05, (r0 + r1) / 2 - 0.012, (r0 + r1) / 2 + 0.012, M.frame));

    // Bowl: drive drum on the table, stainless bowl whose rim meets the track entry.
    const bowlR = 0.11;
    const bowlC = r1 + bowlR - 0.01;
    const rimY = trackY + 0.004;
    const floorY = rimY - 0.07;
    const drum = cyl(0.075, floorY - 0.01 - TABLE, M.drive, 32);
    drum.position.copy(local(0, (TABLE + floorY - 0.01) / 2, bowlC));
    const foot = cyl(0.09, 0.012, M.frame, 32);
    foot.position.copy(local(0, TABLE + 0.006, bowlC));
    const profile = [
      [0.0, 0.02],
      [0.03, 0.006],
      [0.06, 0],
      [0.085, 0],
      [0.094, 0.012],
      [0.1, 0.06],
      [bowlR, 0.07],
      [bowlR + 0.004, 0.072],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), this.bowlMat);
    bowl.position.copy(local(0, floorY, bowlC));
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    // Spiral track climbing the inside wall up to the exit.
    const turns = 1.75;
    const exit = Math.PI / 2; // toward the linear track (-r direction in station space)
    const helix: THREE.Vector3[] = [];
    for (let i = 0; i <= 80; i++) {
      const k = i / 80;
      const ang = exit - (1 - k) * turns * Math.PI * 2;
      helix.push(new THREE.Vector3(Math.cos(ang) * 0.092, 0.008 + k * 0.062, Math.sin(ang) * 0.092));
    }
    const spiral = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 160, 0.004, 6), this.bowlMat);
    spiral.position.copy(bowl.position);
    this.bulk.position.copy(local(0, floorY + 0.012, bowlC));
    this.group.add(drum, foot, bowl, spiral, this.bulk);

    if (def.inline) this.inline = this.buildInline(def.inline, trackY);

    const names: Record<string, string> = { body: 'Pen bodies', spring: 'Springs', springBase: 'Spring bases', housing: 'Housings' };
    this.name = names[def.part] ?? def.id;
    const l = label(this.name, 'label feeder');
    l.position.copy(local(0, rimY + 0.08, bowlC));
    this.tag = l.element;
    this.group.add(l);

    const make = (): THREE.Object3D => {
      if (def.part === 'body') return models.pen_body.clone(true);
      if (def.part === 'spring') return models.spring.clone(true);
      if (def.part === 'springBase') return models.spring_base.clone(true);
      return housingPart(models);
    };
    // Bulk parts lie on the bowl floor in a deterministic jumble, roughly along the wall.
    for (let i = 0; i < 12; i++) {
      const r = (k: number) => (((Math.sin((i + 3) * 37.77 + k * 11.3) * 9631.17) % 1) + 1) % 1;
      const part = make();
      part.rotation.x = Math.PI / 2;
      part.position.z = -heldLength(cfg, parts) / 2; // centre the part along its length
      const holder = new THREE.Group();
      holder.add(part);
      const ang = r(1) * Math.PI * 2;
      const rad = 0.02 + r(2) * 0.025;
      holder.position.set(Math.cos(ang) * rad, (i % 3) * 0.009, Math.sin(ang) * rad);
      holder.rotation.y = -ang;
      this.bulk.add(holder);
    }
    const n = Math.ceil(def.track / def.pitch) + 1;
    for (let i = 0; i < n; i++) {
      const o = make();
      o.position.y = trackY;
      o.visible = false;
      this.pool.push(o);
      this.group.add(o);
    }
  }

  /**
   * EM10 over the track: a camera on a post looking down at the passing parts, an air jet a
   * little further on, and the chute the jet blows bad parts into (on the far side of the track).
   */
  private buildInline(inline: NonNullable<FeederDef['inline']>, trackY: number): NonNullable<FeederView['inline']> {
    const camR = this.feederR + inline.at;
    const jetR = this.feederR + inline.jetAt;
    const top = trackY + 0.1;
    this.group.add(span(-0.06, -0.045, TABLE, top, camR - 0.008, camR + 0.008, M.frame));
    this.group.add(span(-0.06, 0.008, top - 0.01, top, camR - 0.008, camR + 0.008, M.frame));
    this.group.add(span(-0.012, 0.012, trackY + 0.05, top - 0.01, camR - 0.012, camR + 0.012, M.camera));
    const ring = mat(0xffffff, { emissive: 0xbfe3ff, emissiveIntensity: 0.2 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.002, 8, 20), ring);
    torus.rotation.x = Math.PI / 2;
    torus.position.copy(local(0, trackY + 0.048, camR));
    this.group.add(torus);
    // Jet nozzle on one side of the track, chute on the other.
    const nozzle = cyl(0.003, 0.02, M.rail, 12);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.copy(local(-0.03, trackY + 0.006, jetR));
    this.group.add(nozzle, span(-0.045, -0.04, TABLE, trackY + 0.006, jetR - 0.004, jetR + 0.004, M.frame));
    const chute = new THREE.Group();
    const w = 0.05;
    chute.add(span(0.025, 0.025 + w, TABLE, TABLE + 0.004, jetR - 0.03, jetR + 0.03, M.bin));
    for (const [a0, a1, r0, r1] of [
      [0.025, 0.025 + w, jetR - 0.03, jetR - 0.026],
      [0.025, 0.025 + w, jetR + 0.026, jetR + 0.03],
      [0.025 + w - 0.004, 0.025 + w, jetR - 0.03, jetR + 0.03],
    ]) {
      chute.add(span(a0, a1, TABLE, trackY - 0.01, r0, r1, M.bin));
    }
    this.group.add(chute);
    const l = label(`${inline.id} rejects: 0`, 'label bin');
    l.position.copy(local(0.05, trackY + 0.03, jetR));
    this.group.add(l);
    return { at: inline.at, ring, count: l.element, id: inline.id };
  }

  update(items: number[], jam: number, t: number, bins: Record<string, number> = {}): void {
    this.pool.forEach((o, i) => {
      o.visible = i < items.length;
      if (o.visible) o.position.z = -(this.feederR + items[i]);
    });
    if (this.inline) {
      const { at, ring, count, id } = this.inline;
      ring.emissiveIntensity = items.some((x) => Math.abs(x - at) < 0.004) ? 2.5 : 0.2;
      count.textContent = `${id} rejects: ${bins[id] ?? 0}`;
    }
    const jammed = jam > 0;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (!jammed) this.bulk.rotation.y -= dt * 0.6;
    this.tag.classList.toggle('jam', jammed);
    this.tag.textContent = jammed ? `${this.name}: JAM (${Math.ceil(jam)} s)` : this.name;
    const flash = jammed && Math.floor(t * 3) % 2 === 0;
    this.bowlMat.emissive.setHex(flash ? 0xc01818 : 0x000000);
    this.bowlMat.emissiveIntensity = flash ? 0.8 : 0;
  }
}

/** A tray of pens, origin at the tray's underside. */
class TrayLoad {
  readonly group = new THREE.Group();
  private readonly pens: THREE.Object3D[] = [];

  constructor(cfg: LineConfig, models: Models, penBase: number) {
    const t = cfg.layout.tray;
    this.group.add(models.tray.clone(true));
    for (let i = 0; i < cfg.traySize; i++) {
      const pen = finishedPen(cfg, models);
      const p = trayPocket(cfg, i);
      // Pocket positions relative to the tray centre.
      pen.position.copy(local(p.a - t.a, penBase, p.r - t.r));
      pen.visible = false;
      this.pens.push(pen);
      this.group.add(pen);
    }
  }

  fill(n: number): void {
    this.pens.forEach((p, i) => (p.visible = i < n));
  }
}

/**
 * Tray outfeed: the tray being filled sits under the unload robot; full trays index along the
 * conveyor (+a) and queue at its end until taken away.
 */
export class TrayView {
  readonly group = new THREE.Group();
  private readonly current: TrayLoad;
  private readonly queue: TrayLoad[];
  private readonly stackLabel: HTMLElement;
  private readonly trayY: number;
  private static readonly QUEUE = [0.17, 0.32];

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const t = cfg.layout.tray;
    // The gripper lets go with the pen's base just above the tray floor.
    const fullPen = heldLength(cfg, ['body', 'spring', 'springBase', 'cartridge', 'housing']);
    const penBase = cfg.layout.z.tray - fullPen;
    this.trayY = penBase - 0.006;
    // Conveyor: frame on the table with a dark belt on top, side guides at tray height.
    this.group.add(span(t.a - 0.09, t.a + 0.42, TABLE, this.trayY - 0.004, t.r - 0.065, t.r + 0.065, M.frame));
    this.group.add(span(t.a - 0.09, t.a + 0.42, this.trayY - 0.004, this.trayY, t.r - 0.06, t.r + 0.06, M.drive));
    for (const r of [t.r - 0.068, t.r + 0.068]) this.group.add(span(t.a - 0.09, t.a + 0.42, this.trayY - 0.004, this.trayY + 0.012, r - 0.003, r + 0.003, M.rail));
    const make = () => {
      const l = new TrayLoad(cfg, models, penBase - this.trayY);
      this.group.add(l.group);
      return l;
    };
    this.current = make();
    this.queue = TrayView.QUEUE.map(() => make());
    const l = label('Trays out: 0', 'label feeder');
    l.position.copy(local(t.a + 0.3, 0.3, t.r));
    this.stackLabel = l.element;
    this.group.add(l);
  }

  private place(load: TrayLoad, da: number, dy = 0): void {
    const t = this.cfg.layout.tray;
    load.group.position.copy(local(t.a + da, this.trayY + dy, t.r));
  }

  /** `queue`: pen counts of the trays already out, newest first. */
  update(count: number, changing: number, queue: number[], traysOut: number): void {
    const [q0, q1] = TrayView.QUEUE;
    const step = q1 - q0;
    const progress = changing > 0 ? 1 - changing / this.cfg.trayChange : 0;
    // Trays queued on the conveyor: position and pen count (beyond the end they've been taken away).
    let queued: { a: number; n: number }[];
    if (changing > 0 && progress < 0.5) {
      // The filled tray moves out and pushes the queue along.
      const k = progress / 0.5;
      this.place(this.current, k * q0);
      this.current.fill(count);
      queued = queue.map((n, j) => ({ a: q0 + step * (j + k), n }));
    } else {
      // An empty tray comes down from the magazine; the filled one now heads the queue.
      const k = changing > 0 ? (progress - 0.5) / 0.5 : 1;
      this.place(this.current, 0, (1 - k) * 0.08);
      this.current.fill(changing > 0 ? 0 : count);
      queued = (changing > 0 ? [count, ...queue] : queue).map((n, j) => ({ a: q0 + step * j, n }));
    }
    queued = queued.filter((q) => q.a <= q1 + 1e-6);
    this.queue.forEach((load, i) => {
      load.group.visible = i < queued.length;
      if (load.group.visible) {
        this.place(load, queued[i].a);
        load.fill(queued[i].n);
      }
    });
    this.stackLabel.textContent = `Trays out: ${traysOut}`;
  }
}

/**
 * Code printed on the labels of finished pens in trays and bins. Those don't track which pen is
 * which, so they all show this sample; pens on movers and in grippers show their own.
 */
const SAMPLE_CODE = '(01)05712345000014(17)291114(10)B261114(21)A7K2P9X4Q1RZ';

/** A finished, labelled pen, origin at the body's base. */
export function finishedPen(cfg: LineConfig, models: Models): THREE.Object3D {
  const a = new AssemblyView(cfg, models);
  a.show(['body', 'spring', 'springBase', 'cartridge', 'housing']);
  a.setMark(SAMPLE_CODE);
  return a.root;
}

/** A bin that visibly fills up with rejected pens (in whatever state they were rejected). */
export class BinView {
  readonly group = new THREE.Group();
  private shown = 0;
  private readonly countLabel: HTMLElement;

  /** `part`: what lands in the bin, origin at its base; `length`: its length. */
  constructor(
    private readonly name: string,
    private readonly part: THREE.Object3D,
    private readonly length: number,
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
      // Centre the part on its holder so it lies inside the bin.
      const part = this.part.clone(true);
      part.position.y = -this.length / 2;
      const p = new THREE.Group();
      p.add(part);
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
