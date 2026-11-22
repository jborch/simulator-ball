import * as THREE from 'three';
import type { LineConfig, PartType, StationDef } from '../sim/config';
import { heldLength, seatedTip, trayPocket } from '../sim/layout';
import type { Frame, StationFrame } from '../sim/protocol';
import { pose } from '../sim/track';
import { BELT_Y, LIGHT_COLORS, type LightColor, M, RAIL_Y, type Reach, TABLE, cyl, label, lerp, local, v3 } from './build';
import { batch, block, finish, hardware, hose, plate, round, warning } from './hardware';
import { BinView, FeederView, InspectionView, RobotView, ScrapView, TrayView, finishedPen } from './devices';
import type { Models } from './models';
import { AssemblyView } from './movers';

export class StationView {
  readonly group = new THREE.Group();
  readonly scrap: ScrapView;
  private readonly inspection: InspectionView | null = null;
  readonly robot: RobotView | null = null;
  readonly feeders: FeederView[] = [];
  readonly tray: TrayView | null = null;
  readonly bin: BinView | null = null;
  /** Head of the pallet stopper in the belt's centre channel. */
  private readonly pin: THREE.Object3D;
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
      const robots = def.robots ?? [];
      this.robot = new RobotView(
        reach,
        beamR,
        StationView.lowestTip(cfg, def),
        cfg,
        models,
        robots.map((r) => r.parts?.[0] ?? 'housing'),
        robots.some((r) => r.laser),
        def.group === 'EM14',
      );
      this.robot.tag(def.id);
      this.group.add(this.robot.group);
      lightAt = { a: reach.aMin - 0.01, r: beamR, y: RAIL_Y + 0.02 };
    }
    // Each robot's part source sits at its home along the belt.
    for (const r of def.robots ?? []) {
      if (r.source && r.source !== 'cup' && r.source !== 'dial' && r.source !== 'collet') {
        // (Cups, the dial and the collets are drawn with the sub-lines that fill them.)
        const feeder = new FeederView(r.source, r.parts ?? [], cfg, models);
        feeder.group.position.x = r.home;
        this.feeders.push(feeder);
      }
    }
    if (def.kind === 'unload') this.tray = new TrayView(cfg, models);
    if (def.bin) {
      // Early rejects are pens as built so far; the unload station only rejects finished ones.
      const built = StationView.builtBefore(cfg, def);
      const rejected = def.kind === 'reject' ? StationView.partBuilt(cfg, models, built) : finishedPen(cfg, models);
      const length = def.kind === 'reject' ? heldLength(cfg, built) : heldLength(cfg, ['body', 'housing']);
      this.bin = new BinView(def.bin, rejected, length);
      const b = cfg.layout.bins[def.bin];
      // At the tray line the tote stands 4 cm further out along the belt, clear of the
      // destacker's legs; the robot's drop point (b) is still well inside it.
      this.bin.group.position.copy(local(b.a + (def.kind === 'unload' ? -0.04 : 0), TABLE, b.r));
    }
    // What a robot drops when a part doesn't seat: the last part it places.
    const source = def.robots?.filter((r) => r.source).at(-1)?.source;
    const scrapPart =
      source === 'collet' ? models.cartridge : source === 'springs' ? models.spring : source === 'cup' ? models.spring_base : source === 'dial' ? models.housing : models.pen_body;
    this.scrap = new ScrapView(scrapPart);
    for (const part of [...this.feeders, this.tray, this.bin, this.scrap]) if (part) this.group.add(part.group);

    // Pallet stopper in the belt's centre channel, its head just ahead of a resting mover's
    // leading face. The air lines drop from its body to a valve on the outer side profile.
    const fittings = new THREE.Group();
    plate(fittings, -0.092, -0.027, 0.103, 0.089, 0.018, def.id, 'L07   /   TRANSPORT');
    const stopA = cfg.mover.length / 2 + 0.008;
    fittings.add(hardware('Stopper', stopA, 0, 0));
    for (const [dy, m] of [
      [-0.03, finish.pipe],
      [-0.06, finish.seal],
    ] as const) {
      hose(
        fittings,
        [
          [stopA + 0.026, dy, 0.006],
          [stopA + 0.034, dy - 0.012, 0.004],
          [stopA + 0.04, -0.085, -0.03],
          [stopA + 0.048, -0.072, -0.103],
          [stopA + 0.05, -0.04, -0.108],
        ],
        0.0021,
        m,
      );
    }
    block(fittings, stopA + 0.05, -0.03, -0.108, 0.024, 0.03, 0.012, finish.graphite);
    round(fittings, stopA + 0.05, -0.012, -0.108, 0.0035, 0.006, finish.pipe, 12);
    this.pin = hardware('StopHead', stopA, 0, 0);
    this.group.add(this.pin);

    const colors: LightColor[] = ['blue', 'green', 'yellow', 'red'];
    this.lights = {} as Record<LightColor, THREE.Mesh>;
    if (def.kind === 'inspect') lightAt.y = 0.44;
    const postY = lightAt.y;
    lightAt.y += 0.071;
    round(fittings, lightAt.a, postY + 0.035, -lightAt.r, 0.007, 0.082, M.rail);
    round(fittings, lightAt.a, postY + 0.074, -lightAt.r, 0.018, 0.012, M.camera);
    round(fittings, lightAt.a, lightAt.y + 0.104, -lightAt.r, 0.017, 0.006, M.camera);
    const labelZ = -lightAt.r + 0.029;
    if (this.robot)
      plate(fittings, lightAt.a + 0.046, RAIL_Y - 0.008, labelZ, 0.103, 0.029, def.id, def.group === 'EM14' ? 'PRESS MODULE' : 'TRANSFER AXIS');
    if (def.group === 'EM14') {
      const reach = StationView.reach(cfg, def);
      const beamR = StationView.beamR(cfg, def, reach);
      const z = -beamR - 0.026;
      plate(fittings, 0, 0.291, z + 0.01, 0.057, 0.018, def.id, 'INSERTION');
      // On the column's back face (toward the operator aisle), just proud of the enamel.
      const back = z - 0.0631;
      plate(fittings, -0.034, 0.323, z - 0.028, 0.052, 0.020, def.id, 'PNEUMATIC PRESS', '#286e74', -Math.PI / 2);
      warning(fittings, 0, 0.267, back, 0.054, Math.PI);
      const bank = hardware('ValveBank', 0, 0.105, z - 0.056);
      bank.scale.setScalar(0.72);
      bank.rotation.y = Math.PI;
      fittings.add(bank);
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.022 * 0.72;
        hose(
          fittings,
          [
            [x, 0.127, z - 0.075],
            [x, 0.132, z - 0.086],
            [x + 0.005, 0.082, z - 0.095],
            [x, 0.035, z - 0.092],
            [x, TABLE + 0.009, z - 0.093],
          ],
          0.0021,
          i % 2 ? finish.seal : finish.pipe,
          false,
        );
      }
      // The lines drop through a slotted grommet plate in the press foot.
      block(fittings, 0, TABLE + 0.004, z - 0.093, 0.088, 0.009, 0.019, finish.graphite);
    }
    // Beam and station fittings share the same fixed station transform.
    // Keep the independently tracked and moving tools in the robot group.
    if (this.robot) fittings.add(this.robot.frame);
    batch(fittings);
    this.group.add(fittings);
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

  /** Parts a pen has by the time it reaches this station: everything placed upstream of it. */
  private static builtBefore(cfg: LineConfig, def: StationDef): PartType[] {
    const parts = cfg.stations.filter((d) => d.s < def.s).flatMap((d) => (d.robots ?? []).flatMap((r) => (r.source ? (r.parts ?? []) : [])));
    return [...new Set(parts)];
  }

  /** A part-built pen, as rejected at an early reject station. */
  private static partBuilt(cfg: LineConfig, models: Models, parts: PartType[]): THREE.Object3D {
    const a = new AssemblyView(cfg, models);
    a.show(parts);
    return a.root;
  }

  /** Lowest gripper height this station's robot goes to (placing, picking or dropping). */
  private static lowestTip(cfg: LineConfig, def: StationDef): number {
    const z = cfg.layout.z;
    const tips = [z.safe];
    for (const r of def.robots ?? []) {
      if (r.parts) tips.push(seatedTip(cfg, r.parts));
      if (r.source === 'collet') tips.push(cfg.cartridges.collets.base + cfg.parts.cartridge.length);
      else if (r.source === 'cup') tips.push(cfg.distribution.cupZ);
      else if (r.source === 'dial') tips.push(cfg.dial.pickZ);
      else if (r.source) tips.push(cfg.feeders.find((f) => f.id === r.source)!.pickZ);
    }
    if (def.kind === 'reject' || def.kind === 'unload') tips.push(seatedTip(cfg, ['body']));
    if (def.bin) tips.push(z.bin);
    if (def.kind === 'unload') tips.push(z.tray);
    return Math.min(...tips);
  }

  /** The gantry beam stands just outside the bins and tray conveyor under the robot. */
  private static beamR(cfg: LineConfig, def: StationDef, reach: Reach): number {
    let outer = reach.rMax;
    // Stand clear of the distribution conveyor that passes under the presses.
    if (def.robots?.some((r) => r.source === 'cup')) outer = Math.max(outer, cfg.distribution.r + 0.04);
    // ...and behind the housing dial, whose unload position the robot reaches over.
    if (def.robots?.some((r) => r.source === 'dial')) outer = Math.max(outer, cfg.dial.r + cfg.dial.radius + 0.06);
    if (def.bin) outer = Math.max(outer, cfg.layout.bins[def.bin].r + 0.1);
    // ...and the tray and its conveyor.
    if (def.kind === 'unload') outer = Math.max(outer, cfg.layout.tray.r + (cfg.layout.tray.rows * cfg.layout.tray.pitch) / 2 + 0.07);
    return outer + 0.04;
  }

  /** Gantry extent covering every point the robot visits, plus margin. */
  private static reach(cfg: LineConfig, def: StationDef): Reach {
    const pts: { a: number; r: number }[] = [{ a: 0, r: 0 }];
    for (const r of def.robots ?? []) {
      pts.push({ a: r.home, r: 0 });
      // The collet loop runs out under the arm: keep the legs clear of it on either side.
      if (r.source === 'collet') pts.push({ a: r.home, r: cfg.cartridges.collets.pick }, { a: -0.09, r: 0 }, { a: 0.09, r: 0 });
      else if (r.source === 'cup') pts.push({ a: r.home, r: cfg.distribution.cupR });
      else if (r.source === 'dial') pts.push({ a: cfg.dial.a, r: cfg.dial.r - cfg.dial.radius });
      else if (r.source) pts.push({ a: r.home, r: cfg.layout.feederR });
    }
    if (def.bin) {
      const b = cfg.layout.bins[def.bin];
      pts.push(b);
      if (def.kind === 'unload') pts.push({ a: b.a - 0.145, r: b.r });
    }
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
    for (const feeder of this.feeders) {
      const fd = fa.feeders.find((x) => x.id === feeder.id);
      feeder.update(fd?.items ?? [], fd?.jam ?? 0, t, fa.counters.bins);
    }
    this.tray?.update(fa.tray, t, fa.alarms.destacker);
    this.bin?.setCount(fa.counters.bins[this.def.bin!] ?? 0);
    this.scrap.setCount(f.scrap);

    this.inspection?.update(f.progress !== null, t);
    const rb = fb.stations[index].robots;
    if (this.robot && f.robots.length === rb.length) {
      this.robot.update(f.robots.map((ra, k) => ({ ...ra, a: lerp(ra.a, rb[k].a, alpha), r: lerp(ra.r, rb[k].r, alpha), z: lerp(ra.z, rb[k].z, alpha) })), f.laser);
    }
    const pinS = this.def.s + this.pin.position.x;
    const clearing = fa.movers.some((m) => Math.abs(m.s - pinS) < this.pin.position.x - 0.002);
    this.pin.position.y = f.gateClosed && !clearing ? 0.015 : -0.0035;
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
