import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { LineConfig, StationDef } from '../sim/config';
import { nestPocket, trayPocket } from '../sim/devices';
import type { Frame, RobotFrame, StationFrame } from '../sim/protocol';
import { type Pose, pose, trackLength } from '../sim/track';
import type { Sample } from './interp';
import type { Models } from './models';
import { HANG, HeldView, MoverView } from './movers';
import { beltTexture } from './textures';

/** Belt surface height above the floor. Station groups sit at this height. */
export const BELT_Y = 0.9;
/** Table top, relative to the belt surface. */
const TABLE = -0.06;
const BELT_W = 0.13;
const RIB = 0.05;
const RAIL_Y = 0.56;

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });

const M = {
  frame: mat(0xb8bec7, { metalness: 0.6, roughness: 0.35 }),
  table: mat(0x5b6370, { roughness: 0.8 }),
  rail: mat(0xd0d4da, { metalness: 0.8, roughness: 0.25 }),
  axis: mat(0x3d6fb6),
  axisDark: mat(0x2b3a52),
  camera: mat(0x22252a),
  lens: mat(0x111111, { metalness: 0.9, roughness: 0.1 }),
  pin: mat(0xe0a020),
  bin: mat(0xb02b2b, { roughness: 0.7 }),
  bowl: mat(0x9aa3ae, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }),
  nest: mat(0xf2f2f2, { roughness: 0.7 }),
  laser: new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.85 }),
};

const LIGHT_COLORS = { red: 0xff3b30, yellow: 0xffc400, green: 0x34c759, blue: 0x2f7cf6 } as const;
type LightColor = keyof typeof LIGHT_COLORS;

/** Station-local (a along travel, y up, r outward) → three local coordinates of a station group. */
const local = (a: number, y: number, r: number) => new THREE.Vector3(a, y, -r);

function v3(x: number, yPlan: number, h: number): THREE.Vector3 {
  return new THREE.Vector3(x, h, -yPlan);
}

function side(p: Pose, offset: number): { x: number; y: number } {
  return { x: p.x - Math.sin(p.heading) * offset, y: p.y + Math.cos(p.heading) * offset };
}

function label(text: string, cls = 'label'): CSS2DObject {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  return new CSS2DObject(div);
}

function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Box spanning station-local ranges a0..a1, y0..y1, r0..r1. */
function span(a0: number, a1: number, y0: number, y1: number, r0: number, r1: number, m: THREE.Material): THREE.Mesh {
  const b = box(Math.abs(a1 - a0), Math.abs(y1 - y0), Math.abs(r1 - r0), m);
  b.position.copy(local((a0 + a1) / 2, (y0 + y1) / 2, (r0 + r1) / 2));
  return b;
}

function cyl(r: number, h: number, m: THREE.Material, seg = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Reach {
  aMin: number;
  aMax: number;
  rMin: number;
  rMax: number;
}

/** Cartesian gantry robot: a-axis bridge on two rails, r-axis carriage, z-axis column with gripper. */
class RobotView {
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
function cameraGantry(group: THREE.Group): THREE.Object3D {
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
class FeederView {
  readonly group = new THREE.Group();
  private readonly pool: THREE.Object3D[] = [];
  private readonly feederR: number;

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
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.07, 0.08, 32, 1, true), M.bowl);
    bowl.position.copy(local(0, bowlY, bowlR));
    bowl.castShadow = true;
    this.group.add(base, bowl);
    const names: Record<string, string> = { body: 'Pen bodies', spring: 'Springs', housing: 'Housings + caps' };
    const l = label(names[def.part] ?? def.id, 'label feeder');
    l.position.copy(local(0, bowlY + 0.12, bowlR));
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

  update(items: number[]): void {
    this.pool.forEach((o, i) => {
      o.visible = i < items.length;
      if (o.visible) o.position.z = -(this.feederR + items[i]);
    });
  }
}

class NestView {
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

class TrayView {
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
class BinView {
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

class StationView {
  readonly group = new THREE.Group();
  private readonly camera: THREE.Object3D | null = null;
  private readonly cameraRest: number = 0;
  readonly robot: RobotView | null = null;
  readonly feeder: FeederView | null = null;
  readonly nest: NestView | null = null;
  readonly tray: TrayView | null = null;
  readonly bin: BinView | null = null;
  private readonly pin: THREE.Mesh;
  private readonly lights: Record<LightColor, THREE.Mesh>;
  readonly tag: HTMLElement;

  constructor(
    readonly def: StationDef,
    cfg: LineConfig,
    models: Models,
  ) {
    const p = pose(cfg.track, def.s);
    this.group.position.copy(v3(p.x, p.y, BELT_Y));
    this.group.rotation.y = p.heading;

    let lightAt = { a: 0, r: -0.12, y: 0.42 };
    if (def.kind === 'inspect') {
      this.camera = cameraGantry(this.group);
      this.cameraRest = this.camera.position.y;
    } else {
      const reach = StationView.reach(cfg, def);
      this.robot = new RobotView(reach, models, def.kind === 'load');
      this.group.add(this.robot.group);
      lightAt = { a: reach.aMin, r: reach.rMax, y: RAIL_Y + 0.02 };
    }
    if (def.source === 'nest') this.nest = new NestView(cfg, models);
    else if (def.source) this.feeder = new FeederView(def.source, cfg, models);
    if (def.kind === 'unload') this.tray = new TrayView(cfg, models);
    if (def.bin) {
      this.bin = new BinView(def.bin, models.pen);
      const b = cfg.layout.bins[def.bin];
      this.bin.group.position.copy(local(b.a, TABLE, b.r));
    }
    for (const part of [this.nest, this.feeder, this.tray, this.bin]) if (part) this.group.add(part.group);

    // Stop gate pin just ahead of a resting mover's leading face.
    this.pin = cyl(0.008, 0.03, M.pin, 12);
    this.pin.position.set(cfg.mover.length / 2 + 0.008, 0, 0.035);
    this.group.add(this.pin);

    const colors: LightColor[] = ['blue', 'green', 'yellow', 'red'];
    this.lights = {} as Record<LightColor, THREE.Mesh>;
    colors.forEach((c, i) => {
      const m = cyl(0.016, 0.022, new THREE.MeshStandardMaterial({ color: 0x30333a, roughness: 0.4 }), 16);
      m.position.copy(local(lightAt.a, lightAt.y + 0.02 + i * 0.024, lightAt.r));
      this.lights[c] = m;
      this.group.add(m);
    });
    const tagObj = label(def.id, 'label station');
    tagObj.position.copy(local(lightAt.a, lightAt.y + 0.16, lightAt.r));
    this.tag = tagObj.element;
    this.tag.title = def.name;
    this.group.add(tagObj);
  }

  /** Gantry extent covering every point the robot visits, plus margin. */
  private static reach(cfg: LineConfig, def: StationDef): Reach {
    const pts: { a: number; r: number }[] = [{ a: 0, r: 0 }];
    if (def.source === 'nest') for (let i = 0; i < cfg.nestSize; i++) pts.push(nestPocket(cfg, i));
    else if (def.source) pts.push({ a: 0, r: cfg.layout.feederR });
    if (def.bin) pts.push(cfg.layout.bins[def.bin]);
    if (def.kind === 'unload') for (let i = 0; i < cfg.traySize; i++) pts.push(trayPocket(cfg, i));
    const as = pts.map((p) => p.a);
    const rs = pts.map((p) => p.r);
    return { aMin: Math.min(...as) - 0.07, aMax: Math.max(...as) + 0.07, rMin: -0.13, rMax: Math.max(...rs) + 0.07 };
  }

  update(a: StationFrame, b: StationFrame, alpha: number, machineRunning: boolean, t: number): void {
    if (this.camera) {
      const k = b.progress === null ? 0 : Math.sin(Math.min(1, b.progress) * Math.PI);
      this.camera.position.y = this.cameraRest - 0.03 * k;
    }
    if (this.robot && a.robot && b.robot) {
      this.robot.update({ ...b.robot, a: lerp(a.robot.a, b.robot.a, alpha), r: lerp(a.robot.r, b.robot.r, alpha), z: lerp(a.robot.z, b.robot.z, alpha) });
    }
    this.pin.position.y = b.gateClosed ? 0.01 : -0.02;

    const lit: Partial<Record<LightColor, boolean>> = {};
    if (!machineRunning) lit.red = b.status === 'stopped';
    if (b.status === 'working') lit.green = true;
    if (b.status === 'reading' || b.status === 'passing') lit.green = Math.floor(t * 4) % 2 === 0;
    if (b.status === 'waiting') lit.yellow = true;
    if (b.status === 'starved' || b.status === 'blocked') {
      lit.yellow = Math.floor(t * 2) % 2 === 0;
      lit.blue = true;
    }
    for (const c of Object.keys(this.lights) as LightColor[]) {
      const m = this.lights[c].material as THREE.MeshStandardMaterial;
      m.color.setHex(lit[c] ? LIGHT_COLORS[c] : 0x30333a);
      m.emissive.setHex(lit[c] ? LIGHT_COLORS[c] : 0x000000);
      m.emissiveIntensity = lit[c] ? 1.4 : 0;
    }
    this.tag.dataset.status = b.status;
  }
}

export class LineView {
  readonly group = new THREE.Group();
  readonly movers: MoverView[];
  private readonly stations: StationView[];
  private readonly beltTex: THREE.Texture;
  private beltTravel = 0;
  private readonly L: number;

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    this.L = trackLength(cfg.track);
    this.buildTable();
    this.beltTex = beltTexture();
    this.buildBelt();
    this.stations = cfg.stations.map((d) => {
      const sv = new StationView(d, cfg, models);
      this.group.add(sv.group);
      return sv;
    });
    this.movers = Array.from({ length: cfg.mover.count }, (_, i) => {
      const mv = new MoverView(i + 1, models);
      this.group.add(mv.root);
      return mv;
    });
  }

  private buildTable(): void {
    const { straight: S, radius: R } = this.cfg.track;
    const w = S + 2 * R + 0.9;
    const d = 2 * R + 2.0;
    const top = box(w, 0.05, d, M.table);
    top.position.y = BELT_Y + TABLE - 0.025;
    this.group.add(top);
    const h = BELT_Y + TABLE - 0.05;
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06, -w / 6, w / 6]) {
      for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) {
        const leg = box(0.06, h, 0.06, M.frame);
        leg.position.set(x, h / 2, z);
        this.group.add(leg);
      }
    }
  }

  private buildBelt(): void {
    const t = this.cfg.track;
    const n = 720;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const railIn: THREE.Vector3[] = [];
    const railOut: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * this.L;
      const p = pose(t, s);
      const a = side(p, BELT_W / 2);
      const b = side(p, -BELT_W / 2);
      pos.push(a.x, BELT_Y - 0.002, -a.y, b.x, BELT_Y - 0.002, -b.y);
      uv.push(0, s / RIB, 1, s / RIB);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        const o = side(p, BELT_W / 2 + 0.012);
        const inn = side(p, -BELT_W / 2 - 0.012);
        railOut.push(v3(o.x, o.y, BELT_Y + 0.012));
        railIn.push(v3(inn.x, inn.y, BELT_Y + 0.012));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const belt = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.9, side: THREE.DoubleSide }));
    belt.receiveShadow = true;
    this.group.add(belt);

    for (const pts of [railIn, railOut]) {
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 600, 0.006, 8, true), M.rail);
      rail.castShadow = true;
      this.group.add(rail);
    }
    const bodyPts: THREE.Vector3[] = [];
    for (let i = 0; i < 360; i++) {
      const p = pose(t, (i / 360) * this.L);
      bodyPts.push(v3(p.x, p.y, BELT_Y - 0.03));
    }
    const shape = new THREE.Shape();
    shape.moveTo(-0.025, -BELT_W / 2 - 0.015);
    shape.lineTo(0.025, -BELT_W / 2 - 0.015);
    shape.lineTo(0.025, BELT_W / 2 + 0.015);
    shape.lineTo(-0.025, BELT_W / 2 + 0.015);
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { steps: 360, extrudePath: new THREE.CatmullRomCurve3(bodyPts, true), bevelEnabled: false }),
      M.frame,
    );
    body.receiveShadow = true;
    this.group.add(body);
  }

  update(sample: Sample, fb: { moverS(sample: Sample, i: number): number }, dt: number): void {
    const f: Frame = sample.b;
    this.movers.forEach((mv, i) => mv.update(sample.a.movers[i], pose(this.cfg.track, fb.moverS(sample, i)), BELT_Y));

    this.beltTravel += f.beltSpeed * dt;
    this.beltTex.offset.y = -this.beltTravel / RIB;

    const running = f.machine === 'Execute' || f.machine === 'Starting' || f.machine === 'Stopping' || f.machine === 'Holding';
    this.stations.forEach((sv, i) => {
      sv.update(sample.a.stations[i], f.stations[i], sample.alpha, running, sample.t);
      if (sv.feeder) sv.feeder.update(f.feeders.find((x) => x.id === sv.feeder!.id)?.items ?? []);
      if (sv.nest) {
        const n = f.nests.find((x) => x.station === sv.def.id);
        if (n) sv.nest.update(n.slots, n.changing);
      }
      if (sv.tray) sv.tray.update(f.tray.count, f.tray.changing, f.counters.traysOut);
      if (sv.bin) sv.bin.setCount(f.counters.bins[sv.def.bin!] ?? 0);
    });
  }
}
