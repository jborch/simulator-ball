import * as THREE from 'three';
import type { LineConfig, StationDef } from '../sim/config';
import { heldLength, nestPocket, seatedTip, trayPocket } from '../sim/layout';
import type { Frame, StationFrame } from '../sim/protocol';
import { pose } from '../sim/track';
import { BELT_Y, LIGHT_COLORS, type LightColor, M, RAIL_Y, type Reach, TABLE, cyl, label, lerp, local, v3 } from './build';
import { BinView, FeederView, InspectionView, NestView, RobotView, ScrapView, TrayView, finishedPen } from './devices';
import type { Models } from './models';
import { AssemblyView } from './movers';

export class StationView {
  readonly group = new THREE.Group();
  readonly scrap: ScrapView;
  private readonly inspection: InspectionView | null = null;
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

    let lightAt = { a: 0, r: 0.2, y: 0.44 };
    if (def.kind === 'inspect') {
      this.inspection = new InspectionView(cfg, !!def.readsCode);
      this.group.add(this.inspection.group);
    } else {
      const reach = StationView.reach(cfg, def);
      const beamR = StationView.beamR(cfg, def, reach);
      this.robot = new RobotView(reach, beamR, StationView.lowestTip(cfg, def), cfg, models, def.kind === 'load');
      this.group.add(this.robot.group);
      lightAt = { a: reach.aMin - 0.01, r: beamR, y: RAIL_Y + 0.02 };
    }
    if (def.source === 'nest') this.nest = new NestView(cfg, models);
    else if (def.source) this.feeder = new FeederView(def.source, def.parts ?? [], cfg, models);
    if (def.kind === 'unload') this.tray = new TrayView(cfg, models);
    if (def.bin) {
      // Early rejects are part-built pens; the unload station only rejects finished ones.
      const rejected = def.kind === 'reject' ? StationView.partBuilt(cfg, models) : finishedPen(cfg, models);
      const length = def.kind === 'reject' ? cfg.parts.body.length : heldLength(cfg, ['body', 'housing', 'cap']);
      this.bin = new BinView(def.bin, rejected, length);
      const b = cfg.layout.bins[def.bin];
      this.bin.group.position.copy(local(b.a, TABLE, b.r));
    }
    const scrapPart = def.source === 'nest' ? models.cartridge : def.source === 'springs' ? models.spring : def.source === 'housings' ? models.housing : models.pen_body;
    this.scrap = new ScrapView(scrapPart);
    for (const part of [this.nest, this.feeder, this.tray, this.bin, this.scrap]) if (part) this.group.add(part.group);

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

  /** A pen body with its spring, as rejected after the spring inspection. */
  private static partBuilt(cfg: LineConfig, models: Models): THREE.Object3D {
    const a = new AssemblyView(cfg, models);
    a.show(['body', 'spring']);
    return a.root;
  }

  /** Lowest gripper height this station's robot goes to (placing, picking or dropping). */
  private static lowestTip(cfg: LineConfig, def: StationDef): number {
    const z = cfg.layout.z;
    const tips = [z.safe];
    if (def.parts) tips.push(seatedTip(cfg, def.parts));
    if (def.source === 'nest') tips.push(z.nest);
    else if (def.source) tips.push(cfg.feeders.find((f) => f.id === def.source)!.pickZ);
    if (def.kind === 'reject' || def.kind === 'unload') tips.push(seatedTip(cfg, ['body']));
    if (def.bin) tips.push(z.bin);
    if (def.kind === 'unload') tips.push(z.tray);
    return Math.min(...tips);
  }

  /** The gantry beam stands just outside the bins and tray conveyor under the robot. */
  private static beamR(cfg: LineConfig, def: StationDef, reach: Reach): number {
    let outer = reach.rMax;
    if (def.bin) outer = Math.max(outer, cfg.layout.bins[def.bin].r + 0.1);
    if (def.kind === 'unload') outer = Math.max(outer, cfg.layout.tray.r + 0.07);
    return outer + 0.04;
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

  /**
   * Updates the station and its equipment. Discrete state comes from `fa` (the frame at or before
   * render time); robot axes are interpolated toward `fb`.
   */
  update(fa: Frame, fb: Frame, alpha: number, index: number, t: number): void {
    const f = fa.stations[index];
    if (this.feeder) {
      const fd = fa.feeders.find((x) => x.id === this.feeder!.id);
      this.feeder.update(fd?.items ?? [], fd?.jam ?? 0, t);
    }
    const nest = this.nest && fa.nests.find((x) => x.station === this.def.id);
    if (nest) this.nest!.update(nest.slots, nest.changing);
    this.tray?.update(fa.tray.count, fa.tray.changing, fa.tray.queue, fa.counters.traysOut);
    this.bin?.setCount(fa.counters.bins[this.def.bin!] ?? 0);
    this.scrap.setCount(f.scrap);

    this.inspection?.update(f.progress !== null, t);
    const ra = f.robot;
    const rb = fb.stations[index].robot;
    if (this.robot && ra && rb) {
      this.robot.update({ ...ra, a: lerp(ra.a, rb.a, alpha), r: lerp(ra.r, rb.r, alpha), z: lerp(ra.z, rb.z, alpha) });
    }
    this.pin.position.y = f.gateClosed ? 0.01 : -0.02;
    this.setLights(f.status, ['Execute', 'Starting', 'Stopping', 'Holding', 'Completing'].includes(fa.machine), t);
    this.tag.dataset.status = f.status;
  }

  /** Stack light: green working, yellow waiting, blue+yellow starved/blocked, red fault/stopped. */
  private setLights(status: StationFrame['status'], machineRunning: boolean, t: number): void {
    const blink = (hz: number) => Math.floor(t * hz) % 2 === 0;
    const lit: Partial<Record<LightColor, boolean>> = {
      red: status === 'fault' ? blink(3) : !machineRunning && status === 'stopped',
      green: status === 'working' || ((status === 'reading' || status === 'passing') && blink(4)),
      yellow: status === 'waiting' || ((status === 'starved' || status === 'blocked') && blink(2)),
      blue: status === 'starved' || status === 'blocked',
    };
    for (const c of Object.keys(this.lights) as LightColor[]) {
      const m = this.lights[c].material as THREE.MeshStandardMaterial;
      m.color.setHex(lit[c] ? LIGHT_COLORS[c] : 0x30333a);
      m.emissive.setHex(lit[c] ? LIGHT_COLORS[c] : 0x000000);
      m.emissiveIntensity = lit[c] ? 1.4 : 0;
    }
  }
}
