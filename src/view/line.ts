import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { LineConfig, StationDef } from '../sim/config';
import type { Frame, StationFrame } from '../sim/protocol';
import { type Pose, pose, trackLength } from '../sim/track';
import type { Sample } from './interp';
import { type Models } from './models';
import { MoverView } from './movers';
import { beltTexture } from './textures';

/** Belt surface height above the floor. */
export const BELT_Y = 0.9;
const BELT_W = 0.13;
const RIB = 0.05;

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...extra });

const M = {
  frame: mat(0xb8bec7, { metalness: 0.6, roughness: 0.35 }),
  table: mat(0x5b6370, { roughness: 0.8 }),
  rail: mat(0xd0d4da, { metalness: 0.8, roughness: 0.25 }),
  head: mat(0x3d6fb6),
  camera: mat(0x22252a),
  lens: mat(0x111111, { metalness: 0.9, roughness: 0.1 }),
  pin: mat(0xe0a020),
  bin: mat(0xb02b2b, { roughness: 0.7 }),
  bowl: mat(0x9aa3ae, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }),
  off: mat(0x30333a),
};

const LIGHT_COLORS = { red: 0xff3b30, yellow: 0xffc400, green: 0x34c759, blue: 0x2f7cf6 } as const;
type LightColor = keyof typeof LIGHT_COLORS;

function v3(x: number, yPlan: number, h: number): THREE.Vector3 {
  return new THREE.Vector3(x, h, -yPlan);
}

/** Point offset sideways from the track: positive = outside of the loop (left of travel). */
function side(p: Pose, offset: number, along = 0): { x: number; y: number } {
  return {
    x: p.x - Math.sin(p.heading) * offset + Math.cos(p.heading) * along,
    y: p.y + Math.cos(p.heading) * offset + Math.sin(p.heading) * along,
  };
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

function cyl(r: number, h: number, m: THREE.Material, seg = 24): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

class StationView {
  readonly group = new THREE.Group();
  private readonly head: THREE.Object3D;
  private readonly headRest: number;
  private readonly pin: THREE.Mesh;
  private readonly lights: Record<LightColor, THREE.Mesh>;
  readonly tag: HTMLElement;

  constructor(
    readonly def: StationDef,
    cfg: LineConfig,
  ) {
    const p = pose(cfg.track, def.s);
    this.group.position.copy(v3(p.x, p.y, BELT_Y));
    this.group.rotation.y = p.heading;

    // Gantry: two posts straddling the belt and a crossbeam (local x = along travel, z = toward inside).
    const postH = 0.42;
    for (const z of [-0.12, 0.12]) {
      const post = box(0.03, postH, 0.03, M.frame);
      post.position.set(0, postH / 2 - 0.03, z);
      this.group.add(post);
    }
    const beam = box(0.05, 0.04, 0.29, M.frame);
    beam.position.set(0, postH - 0.03, 0);
    this.group.add(beam);

    const inspect = def.kind === 'inspect';
    if (inspect) {
      const cam = new THREE.Group();
      const bodyM = box(0.05, 0.07, 0.05, M.camera);
      const lens = cyl(0.014, 0.03, M.lens);
      lens.position.y = -0.045;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 24), mat(0xffffff, { emissive: 0xbfe3ff, emissiveIntensity: 0.6 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.065;
      cam.add(bodyM, lens, ring);
      this.head = cam;
    } else {
      const tool = new THREE.Group();
      const slide = box(0.04, 0.12, 0.04, def.kind === 'reject' ? M.bin : M.head);
      const fingerL = box(0.008, 0.03, 0.012, M.rail);
      const fingerR = fingerL.clone();
      fingerL.position.set(0, -0.075, -0.012);
      fingerR.position.set(0, -0.075, 0.012);
      tool.add(slide, fingerL, fingerR);
      this.head = tool;
    }
    this.headRest = inspect ? postH - 0.1 : postH - 0.12;
    this.head.position.y = this.headRest;
    this.group.add(this.head);

    // Stop gate pin just ahead of a resting mover's leading face.
    this.pin = cyl(0.008, 0.03, M.pin, 12);
    this.pin.position.set(cfg.mover.length / 2 + 0.008, 0, 0.035);
    this.group.add(this.pin);

    // Stack light on the outer post.
    const colors: LightColor[] = ['blue', 'green', 'yellow', 'red'];
    this.lights = {} as Record<LightColor, THREE.Mesh>;
    colors.forEach((c, i) => {
      const m = cyl(0.016, 0.022, new THREE.MeshStandardMaterial({ color: 0x30333a, roughness: 0.4 }), 16);
      m.position.set(0, postH + 0.01 + i * 0.024, -0.12);
      this.lights[c] = m;
      this.group.add(m);
    });

    const tagObj = label(`${def.id}`, 'label station');
    tagObj.position.set(0, postH + 0.15, -0.12);
    this.tag = tagObj.element;
    this.tag.title = def.name;
    this.group.add(tagObj);
  }

  update(f: StationFrame, machineRunning: boolean, t: number): void {
    const stroke = this.def.kind === 'inspect' ? 0.03 : 0.06;
    const k = f.progress === null ? 0 : Math.sin(Math.min(1, f.progress) * Math.PI);
    this.head.position.y = this.headRest - stroke * k;
    this.pin.position.y = f.gateClosed ? 0.01 : -0.02;

    const lit: Partial<Record<LightColor, boolean>> = {};
    if (!machineRunning) lit.red = f.status === 'stopped';
    if (f.status === 'working') lit.green = true;
    if (f.status === 'reading' || f.status === 'passing') lit.green = Math.floor(t * 4) % 2 === 0;
    if (f.status === 'waiting') lit.yellow = true;
    for (const c of Object.keys(this.lights) as LightColor[]) {
      const m = this.lights[c].material as THREE.MeshStandardMaterial;
      m.color.setHex(lit[c] ? LIGHT_COLORS[c] : 0x30333a);
      m.emissive.setHex(lit[c] ? LIGHT_COLORS[c] : 0x000000);
      m.emissiveIntensity = lit[c] ? 1.4 : 0;
    }
    this.tag.dataset.status = f.status;
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
    const w = 0.26;
    const d = 0.2;
    const h = 0.16;
    const floor = box(w, 0.01, d, M.bin);
    floor.position.y = 0.005;
    this.group.add(floor);
    for (const [x, z, sw, sd] of [
      [0, d / 2, w, 0.01],
      [0, -d / 2, w, 0.01],
      [w / 2, 0, 0.01, d],
      [-w / 2, 0, 0.01, d],
    ]) {
      const wall = box(sw, h, sd, M.bin);
      wall.position.set(x, h / 2, z);
      this.group.add(wall);
    }
    const l = label(`${name}: 0`, 'label bin');
    l.position.set(0, h + 0.08, 0);
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
      const r = (k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;
      p.rotation.set(Math.PI / 2, 0, (r(1) - 0.5) * 1.2);
      p.position.set((r(2) - 0.5) * 0.06, 0.02 + Math.floor(i / 8) * 0.017, (r(3) - 0.5) * 0.1);
      this.group.add(p);
      this.shown++;
    }
  }
}

export class LineView {
  readonly group = new THREE.Group();
  readonly movers: MoverView[];
  private readonly stations: StationView[];
  private readonly beltTex: THREE.Texture;
  private beltTravel = 0;
  private readonly bins: Record<string, BinView> = {};
  private readonly trayPens: THREE.Object3D[] = [];
  private readonly trayStack: THREE.Object3D[] = [];
  private readonly trayStackLabel: HTMLElement;
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
      const sv = new StationView(d, cfg);
      this.group.add(sv.group);
      return sv;
    });

    this.movers = Array.from({ length: cfg.mover.count }, (_, i) => {
      const mv = new MoverView(i + 1, models);
      this.group.add(mv.root);
      return mv;
    });

    this.buildFeeders(models);
    const outfeed = this.buildOutfeed(models);
    this.trayStackLabel = outfeed;
    for (const d of cfg.stations.filter((x) => x.bin)) {
      const bin = new BinView(d.bin!, models.pen);
      const p = pose(cfg.track, d.s);
      const at = side(p, 0.3, d.kind === 'unload' ? -0.3 : 0);
      bin.group.position.copy(v3(at.x, at.y, BELT_Y - 0.06));
      bin.group.rotation.y = p.heading;
      this.bins[d.bin!] = bin;
      this.group.add(bin.group);
    }
  }

  private stationPose(id: string): Pose {
    return pose(this.cfg.track, this.cfg.stations.find((d) => d.id === id)!.s);
  }

  private buildTable(): void {
    const { straight: S, radius: R } = this.cfg.track;
    const w = S + 2 * R + 0.6;
    const d = 2 * R + 1.3;
    const top = box(w, 0.05, d, M.table);
    top.position.y = BELT_Y - 0.085;
    this.group.add(top);
    for (const x of [-w / 2 + 0.06, w / 2 - 0.06, -w / 6, w / 6]) {
      for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) {
        const leg = box(0.06, BELT_Y - 0.11, 0.06, M.frame);
        leg.position.set(x, (BELT_Y - 0.11) / 2, z);
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

    // Side rails and the conveyor body under the belt.
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

  private buildFeeders(models: Models): void {
    const bowl = (id: string, text: string) => {
      const p = this.stationPose(id);
      const at = side(p, 0.42);
      const g = new THREE.Group();
      const base = cyl(0.07, 0.12, M.frame);
      base.position.y = 0.06;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.07, 0.08, 32, 1, true), M.bowl);
      b.position.y = 0.16;
      b.castShadow = true;
      const track = box(0.03, 0.01, 0.24, M.rail);
      track.position.set(0, 0.12, -0.2);
      g.add(base, b, track);
      const l = label(text, 'label feeder');
      l.position.y = 0.3;
      g.add(l);
      g.position.copy(v3(at.x, at.y, BELT_Y - 0.06));
      g.rotation.y = p.heading;
      this.group.add(g);
    };
    bowl('ST10', 'Pen bodies');
    bowl('ST20', 'Springs');
    bowl('ST50', 'Housings + caps');

    // Cartridge nest between the twin stations, picked by the de-nest robot.
    const a = this.stationPose('ST40A');
    const b = this.stationPose('ST40B');
    const mid = side({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, heading: a.heading }, 0.36);
    const nest = models.nest.clone(true);
    nest.position.copy(v3(mid.x, mid.y, BELT_Y - 0.06));
    this.group.add(nest);
    const l = label('Cartridge nests', 'label feeder');
    l.position.copy(v3(mid.x, mid.y, BELT_Y + 0.2));
    this.group.add(l);
  }

  /** Tray being filled at ST70 plus a stack of finished trays. Returns the stack label element. */
  private buildOutfeed(models: Models): HTMLElement {
    const p = this.stationPose('ST70');
    const at = side(p, 0.3, 0.05);
    const tray = models.tray.clone(true);
    const g = new THREE.Group();
    g.position.copy(v3(at.x, at.y, BELT_Y - 0.06));
    g.rotation.y = p.heading;
    g.add(tray);
    const pitch = 0.03;
    for (let i = 0; i < this.cfg.traySize; i++) {
      const pen = models.pen.clone(true);
      const col = i % 4;
      const row = Math.floor(i / 4);
      // Pens stand upright in the tray pockets.
      pen.position.set((col - 1.5) * pitch, 0.014, (row - 1) * pitch);
      pen.visible = false;
      this.trayPens.push(pen);
      g.add(pen);
    }
    this.group.add(g);

    const stackAt = side(p, 0.3, 0.32);
    const stack = new THREE.Group();
    stack.position.copy(v3(stackAt.x, stackAt.y, BELT_Y - 0.06));
    stack.rotation.y = p.heading;
    for (let i = 0; i < 12; i++) {
      const t = models.tray.clone(true);
      t.position.y = i * 0.022;
      t.visible = false;
      this.trayStack.push(t);
      stack.add(t);
    }
    const l = label('Trays out: 0', 'label feeder');
    l.position.y = 0.32;
    stack.add(l);
    this.group.add(stack);
    return l.element;
  }

  update(sample: Sample, fb: { moverS(sample: Sample, i: number): number }, dt: number): void {
    const f: Frame = sample.b;
    this.movers.forEach((mv, i) => mv.update(sample.a.movers[i], pose(this.cfg.track, fb.moverS(sample, i)), BELT_Y));

    this.beltTravel += f.beltSpeed * dt;
    this.beltTex.offset.y = -this.beltTravel / RIB;

    const running = f.machine === 'Execute' || f.machine === 'Starting' || f.machine === 'Stopping' || f.machine === 'Holding';
    this.stations.forEach((sv, i) => sv.update(f.stations[i], running, sample.t));

    for (const [name, n] of Object.entries(f.counters.bins)) this.bins[name]?.setCount(n);
    this.trayPens.forEach((p, i) => (p.visible = i < f.counters.trayFill));
    this.trayStack.forEach((t, i) => (t.visible = i < Math.min(f.counters.traysOut, this.trayStack.length)));
    this.trayStackLabel.textContent = `Trays out: ${f.counters.traysOut}`;
  }
}
