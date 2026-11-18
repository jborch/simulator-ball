// UN01's spring base sub-line, drawn in the station-local frame of the point beside the loop where
// the orienter stands (a along travel, r outward): the spring base bowl and track, EM13 turning
// and checking each part, and the distribution conveyor along the straight to the four EM14
// presses, with a diverter and a pick cup at each.
import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { heldLength } from '../sim/layout';
import type { Frame } from '../sim/protocol';
import { colletLoopLength, colletPoint, denestHeights, tubPocket, tubSize } from '../sim/cartridges';
import { pose } from '../sim/track';
import { BELT_Y, M, TABLE, cyl, label, lerp, local, mat, span, v3 } from './build';
import { FeederView, RobotView } from './devices';
import { housingPart, showLabel } from './movers';
import type { Models } from './models';

export class SpringBaseLineView {
  readonly group = new THREE.Group();
  private readonly feeder: FeederView;
  private readonly chuck = new THREE.Group();
  private readonly chuckPart: THREE.Object3D;
  private readonly ring: THREE.MeshStandardMaterial;
  private readonly pool: THREE.Object3D[] = [];
  private readonly cups: { part: THREE.Object3D; pusher: THREE.Object3D; a: number }[] = [];
  private readonly rejects: HTMLElement;
  private readonly conveyY: number;

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const o = cfg.orienter;
    const d = cfg.distribution;
    const p = pose(cfg.track, o.s);
    this.group.position.copy(v3(p.x, p.y, BELT_Y));
    this.group.rotation.y = p.heading;

    // The bowl's track runs out from the orienter, which takes parts off its end.
    this.feeder = new FeederView(o.feeder, ['springBase'], cfg, models);
    this.group.add(this.feeder.group);

    // Parts ride the conveyor (and sit in the cups) with their top at the gripper's pick height.
    const partLen = heldLength(cfg, ['springBase']);
    this.conveyY = d.cupZ - partLen;
    const y = this.conveyY;
    const length = Math.max(...d.stations.map((id) => cfg.stations.find((s) => s.id === id)!.s)) - d.from + 0.04;

    // EM13: a drive block with a turning chuck at the start of the conveyor, and a camera over it.
    this.group.add(span(-0.03, 0.03, TABLE, y - 0.004, d.r - 0.03, d.r + 0.03, M.drive));
    const chuckBody = cyl(0.012, 0.006, M.axis, 20);
    chuckBody.position.y = -0.003;
    this.chuck.add(chuckBody);
    this.chuckPart = models.spring_base.clone(true);
    this.chuck.add(this.chuckPart);
    this.chuck.position.copy(local(0, y, d.r));
    this.group.add(this.chuck);
    this.group.add(span(-0.06, -0.048, TABLE, y + 0.09, d.r - 0.006, d.r + 0.006, M.frame));
    this.group.add(span(-0.06, 0.006, y + 0.08, y + 0.09, d.r - 0.006, d.r + 0.006, M.frame));
    this.group.add(span(-0.01, 0.01, y + 0.045, y + 0.08, d.r - 0.01, d.r + 0.01, M.camera));
    this.ring = mat(0xffffff, { emissive: 0xbfe3ff, emissiveIntensity: 0.2 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0018, 8, 20), this.ring);
    torus.rotation.x = Math.PI / 2;
    torus.position.copy(local(0, y + 0.043, d.r));
    this.group.add(torus);
    // Reject chute on the inner side of the chuck.
    this.group.add(span(-0.025, 0.025, TABLE, TABLE + 0.004, d.r - 0.1, d.r - 0.05, M.bin));
    this.group.add(span(-0.025, 0.025, TABLE, y - 0.02, d.r - 0.1, d.r - 0.096, M.bin));
    this.group.add(span(-0.025, -0.021, TABLE, y - 0.02, d.r - 0.1, d.r - 0.05, M.bin));
    this.group.add(span(0.021, 0.025, TABLE, y - 0.02, d.r - 0.1, d.r - 0.05, M.bin));
    const l = label(`${o.id} rejects: 0`, 'label bin');
    l.position.copy(local(0, y + 0.02, d.r - 0.075));
    this.rejects = l.element;
    this.group.add(l);
    const name = label(`${o.id} ${o.name}`, 'label feeder');
    name.position.copy(local(0, y + 0.14, d.r));
    this.group.add(name);

    // Conveyor: frame on legs, belt on top, guides either side.
    this.group.add(span(0.02, length, y - 0.012, y - 0.002, d.r - 0.018, d.r + 0.018, M.frame));
    this.group.add(span(0.02, length, y - 0.002, y, d.r - 0.014, d.r + 0.014, M.drive));
    for (const r of [d.r - 0.016, d.r + 0.016]) this.group.add(span(0.02, length, y, y + 0.006, r - 0.0015, r + 0.0015, M.rail));
    for (let a = 0.1; a < length; a += 0.4) this.group.add(span(a - 0.008, a + 0.008, TABLE, y - 0.012, d.r - 0.008, d.r + 0.008, M.frame));
    this.group.add(span(length, length + 0.006, y, y + 0.012, d.r - 0.016, d.r + 0.016, M.frame));

    // A cup beside the conveyor at each press, and a pusher behind it that diverts a part into it.
    for (const id of d.stations) {
      const a = cfg.stations.find((s) => s.id === id)!.s - d.from;
      this.group.add(span(a - 0.012, a + 0.012, TABLE, y, d.cupR - 0.012, d.cupR + 0.012, M.frame));
      const cupRim = cyl(0.008, 0.004, M.nest, 16);
      cupRim.position.copy(local(a, y - 0.002, d.cupR));
      this.group.add(cupRim);
      const part = models.spring_base.clone(true);
      part.position.copy(local(a, y, d.cupR));
      this.group.add(part);
      const pusher = span(-0.006, 0.006, y + 0.001, y + 0.007, -0.004, 0.004, M.axis);
      pusher.position.copy(local(a, 0, d.r + 0.025));
      this.group.add(pusher, span(a - 0.01, a + 0.01, TABLE, y + 0.008, d.r + 0.03, d.r + 0.05, M.drive));
      this.cups.push({ part, pusher, a });
    }

    const n = Math.ceil(length / d.pitch) + 2;
    for (let i = 0; i < n; i++) {
      const o = models.spring_base.clone(true);
      o.visible = false;
      this.pool.push(o);
      this.group.add(o);
    }
  }

  update(f: Frame, t: number): void {
    const d = this.cfg.distribution;
    const fd = f.feeders.find((x) => x.id === this.cfg.orienter.feeder);
    this.feeder.update(fd?.items ?? [], fd?.jam ?? 0, t, f.counters.bins);

    const { phase, progress } = f.orienter;
    this.chuckPart.visible = phase !== 'idle';
    // The chuck turns the part while turning, then holds still for the camera.
    const turning = phase === 'turning';
    if (turning) this.chuck.rotation.y = progress * Math.PI * 3;
    this.ring.emissiveIntensity = phase === 'measuring' && Math.floor(t * 8) % 2 === 0 ? 2.5 : 0.2;
    this.rejects.textContent = `${this.cfg.orienter.id} rejects: ${f.counters.bins[this.cfg.orienter.id] ?? 0}`;

    const items = f.distribution.items;
    this.pool.forEach((o, i) => {
      o.visible = i < items.length;
      if (o.visible) o.position.copy(local(items[i] - d.from, this.conveyY, d.r));
    });
    this.cups.forEach((c, i) => {
      const state = f.distribution.cups[i] ?? 0;
      // While filling, the part is on its way from the conveyor to the cup.
      c.part.visible = state !== 0;
      c.part.position.copy(local(c.a, this.conveyY, state === 2 ? (d.r + d.cupR) / 2 : d.cupR));
      c.pusher.position.z = -(state === 2 ? d.r - 0.008 : d.r + 0.025);
    });
  }
}

/**
 * UN02's housing dial beside EM40, in EM40's station-local frame: a turntable with a nest per
 * position, the housing feeder ending at the load position (EM30), the label applicator (EM31),
 * a camera aimed at the label (EM32), the eject pusher and its bin, and the unload position
 * facing the belt where EM40's robot picks.
 */
export class HousingDialView {
  readonly group = new THREE.Group();
  private readonly feeder: FeederView;
  private readonly disc = new THREE.Group();
  private readonly housings: THREE.Object3D[] = [];
  private readonly applicatorPad: THREE.Object3D;
  private readonly ring: THREE.MeshStandardMaterial;
  private readonly ejector: THREE.Object3D;
  private readonly rejects: HTMLElement;
  private readonly nestY: number;

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const d = cfg.dial;
    const station = cfg.stations.find((s) => s.id === d.station)!;
    const p = pose(cfg.track, station.s);
    this.group.position.copy(v3(p.x, p.y, BELT_Y));
    this.group.rotation.y = p.heading;
    this.feeder = new FeederView(d.feeder, ['housing'], cfg, models);
    this.group.add(this.feeder.group);

    // Housings stand in the nests with their top at the robot's pick height.
    this.nestY = d.pickZ - heldLength(cfg, ['housing']);
    const y = this.nestY;
    const column = cyl(0.04, y - 0.012 - TABLE, M.drive, 24);
    column.position.copy(local(d.a, (TABLE + y - 0.012) / 2, d.r));
    const plate = cyl(d.radius + 0.025, 0.012, M.frame, 48);
    plate.position.y = -0.006;
    this.disc.add(plate);
    for (let i = 0; i < d.nests; i++) {
      const nest = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 8, 20), M.drive);
      nest.rotation.x = Math.PI / 2;
      const [a, r] = this.at(i, 0);
      nest.position.set(a - d.a, 0.002, -(r - d.r));
      this.disc.add(nest);
    }
    this.disc.position.copy(local(d.a, y, d.r));
    this.group.add(column, this.disc);

    for (let i = 0; i < d.nests; i++) {
      const h = housingPart(models);
      h.visible = false;
      this.housings.push(h);
      this.group.add(h);
    }

    // EM31: applicator body with the label roll, and a pad that presses the label on.
    const [la, lr] = this.at(d.positions.label, 0.055);
    const applicator = new THREE.Group();
    applicator.add(span(-0.03, 0.03, 0, 0.09, -0.02, 0.02, M.camera));
    const roll = cyl(0.025, 0.012, mat(0xf5f5f0, { roughness: 0.7 }), 24);
    roll.rotation.x = Math.PI / 2;
    roll.position.set(0, 0.11, 0);
    applicator.add(roll);
    this.applicatorPad = span(-0.012, 0.012, 0.03, 0.06, -0.035, -0.02, M.axis);
    applicator.add(this.applicatorPad);
    applicator.position.copy(local(la, y, lr));
    // Facing the dial centre.
    applicator.rotation.set(0, Math.atan2(la - d.a, -(lr - d.r)) + Math.PI, 0);
    this.group.add(applicator, span(la - 0.02, la + 0.02, TABLE, y, lr - 0.02, lr + 0.02, M.frame));

    // EM32: camera on a post, looking at the label from outside the dial.
    const [ca, cr] = this.at(d.positions.inspect, 0.08);
    this.group.add(span(ca - 0.01, ca + 0.01, TABLE, y + 0.06, cr - 0.01, cr + 0.01, M.frame));
    const cam = new THREE.Group();
    cam.add(span(-0.015, 0.015, -0.015, 0.015, -0.025, 0.015, M.camera));
    this.ring = mat(0xffffff, { emissive: 0xbfe3ff, emissiveIntensity: 0.2 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 8, 20), this.ring);
    torus.position.z = 0.028;
    cam.add(torus);
    cam.position.copy(local(ca, y + 0.045, cr));
    cam.rotation.set(0, Math.atan2(ca - d.a, -(cr - d.r)), 0);
    this.group.add(cam);

    // Eject: a pusher at the eject position and the bin it pushes into, outside the dial.
    const [ea, er] = this.at(d.positions.eject, -0.04);
    this.ejector = span(-0.008, 0.008, y + 0.01, y + 0.03, -0.008, 0.008, M.axis);
    this.ejector.position.x = ea;
    this.ejector.position.z = -er;
    this.ejector.userData.home = new THREE.Vector3(ea, 0, -er);
    const [ba, br] = this.at(d.positions.eject, 0.11);
    const bin = new THREE.Group();
    const w = 0.07;
    bin.add(span(-w / 2, w / 2, TABLE, TABLE + 0.005, -w / 2, w / 2, M.bin));
    for (const [a0, a1, r0, r1] of [
      [-w / 2, w / 2, -w / 2, -w / 2 + 0.004],
      [-w / 2, w / 2, w / 2 - 0.004, w / 2],
      [-w / 2, -w / 2 + 0.004, -w / 2, w / 2],
      [w / 2 - 0.004, w / 2, -w / 2, w / 2],
    ]) {
      bin.add(span(a0, a1, TABLE, y - 0.04, r0, r1, M.bin));
    }
    bin.position.copy(local(ba, 0, br));
    this.group.add(this.ejector, bin);
    const l = label(`${d.inspect.id} rejects: 0`, 'label bin');
    l.position.copy(local(ba, y, br));
    this.rejects = l.element;
    this.group.add(l);
    const name = label(`${d.load.id}–${d.inspect.id} housing dial`, 'label feeder');
    name.position.copy(local(d.a, y + 0.24, d.r));
    this.group.add(name);
  }

  /**
   * Station-local (a, r) of dial position `pos` (fractional while turning), `out` beyond the nest
   * circle. Position `unload` faces the belt, and positions count in the direction the dial turns.
   */
  private at(pos: number, out: number): [number, number] {
    const d = this.cfg.dial;
    const angle = -Math.PI / 2 + ((pos - d.positions.unload) * 2 * Math.PI) / d.nests;
    const rad = d.radius + out;
    return [d.a + rad * Math.cos(angle), d.r + rad * Math.sin(angle)];
  }

  update(f: Frame, t: number): void {
    const d = this.cfg.dial;
    const fd = f.feeders.find((x) => x.id === d.feeder);
    this.feeder.update(fd?.items ?? [], fd?.jam ?? 0, t, f.counters.bins);
    const { slots, labels, turn, active } = f.dial;
    this.disc.rotation.y = -(turn * 2 * Math.PI) / d.nests;
    this.housings.forEach((h, pos) => {
      h.visible = (slots[pos] ?? 0) !== 0;
      if (!h.visible) return;
      const [a, r] = this.at(pos + turn, 0);
      h.position.copy(local(a, this.nestY, r));
      // The label faces outward, where EM31 put it on and EM32 looks.
      h.rotation.y = Math.atan2(a - d.a, -(r - d.r)) + Math.PI;
      showLabel(h, labels[pos] ?? null);
    });
    this.applicatorPad.position.z = active.label && Math.floor(t * 4) % 2 === 0 ? -0.012 : 0;
    this.ring.emissiveIntensity = active.inspect && Math.floor(t * 8) % 2 === 0 ? 2.5 : 0.2;
    const home = this.ejector.userData.home as THREE.Vector3;
    const [ia, ir] = this.at(d.positions.eject, -0.01);
    this.ejector.position.set(active.eject ? ia : home.x, 0, active.eject ? -ir : home.z);
    this.rejects.textContent = `${d.inspect.id} rejects: ${f.counters.bins[d.inspect.id] ?? 0}`;
  }
}

/** A tub (nest) of cartridges: white tray with pockets, cartridges drawn as one instanced mesh. */
class TubView {
  readonly group = new THREE.Group();
  private readonly carts: THREE.InstancedMesh;
  private shown = -1;

  constructor(private readonly cfg: LineConfig) {
    const t = cfg.cartridges.tub;
    const w = t.cols * t.pitch + 0.012;
    const d = t.rows * t.pitch + 0.012;
    this.group.add(span(-w / 2, w / 2, t.floor - 0.012, t.floor, -d / 2, d / 2, M.nest));
    const len = cfg.parts.cartridge.length;
    const geo = new THREE.CylinderGeometry(cfg.parts.cartridge.radius, cfg.parts.cartridge.radius, len, 10);
    geo.translate(0, len / 2, 0);
    this.carts = new THREE.InstancedMesh(geo, mat(0xdfeaf2, { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }), tubSize(cfg));
    this.carts.castShadow = true;
    this.group.add(this.carts);
    this.fill(tubSize(cfg));
  }

  /** Shows the cartridges still in the tub: pockets are emptied in order, so the last `left`. */
  fill(left: number): void {
    if (left === this.shown) return;
    this.shown = left;
    const n = tubSize(this.cfg);
    const t = this.cfg.cartridges.tub;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const p = tubPocket(this.cfg, i);
      const scale = i >= n - left ? 1 : 0;
      m.makeScale(scale, scale, scale).setPosition(p.a - t.a, t.floor, -(p.r - t.r));
      this.carts.setMatrixAt(i, m);
    }
    this.carts.instanceMatrix.needsUpdate = true;
  }
}

/**
 * EM41's cartridge supply in EM41's station-local frame: the tub conveyor, EM00's gantry
 * reaching from the tub to the fill point, and the collet loop that brings full collets to the
 * pick point by the belt.
 */
export class CartridgeCellView {
  readonly group = new THREE.Group();
  private readonly current: TubView;
  private readonly next: TubView;
  private readonly robot: RobotView;
  private readonly collets: { root: THREE.Group; cart: THREE.Object3D }[] = [];
  private readonly tubLabel: HTMLElement;

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const c = cfg.cartridges;
    const station = cfg.stations.find((s) => s.id === c.station)!;
    const p = pose(cfg.track, station.s);
    this.group.position.copy(v3(p.x, p.y, BELT_Y));
    this.group.rotation.y = p.heading;

    // Collet loop: a guide rail along the loop on a plate, with a stop at each end.
    const col = c.collets;
    const pts = Array.from({ length: 96 }, (_, i) => {
      const q = colletPoint(cfg, (colletLoopLength(cfg) * i) / 96);
      return local(q.a, col.base - 0.004, q.r);
    });
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 192, 0.004, 6, true), M.rail);
    this.group.add(rail);
    this.group.add(span(-col.radius - 0.02, col.radius + 0.02, TABLE, col.base - 0.01, col.pick - 0.02, col.fill + 0.02, M.frame));
    for (let i = 0; i < col.count; i++) {
      const root = new THREE.Group();
      const cup = cyl(0.008, 0.016, M.axis, 16);
      cup.position.y = 0.008;
      const cart = models.cartridge.clone(true);
      root.add(cup, cart);
      this.collets.push({ root, cart });
      this.group.add(root);
    }

    // Tub conveyor along the belt, behind the collet loop; tubs come in from +a, empties leave to -a.
    const t = c.tub;
    const d = t.rows * t.pitch + 0.03;
    this.group.add(span(t.a - 0.35, t.a + 0.5, TABLE, t.floor - 0.016, t.r - d / 2, t.r + d / 2, M.frame));
    this.group.add(span(t.a - 0.35, t.a + 0.5, t.floor - 0.016, t.floor - 0.012, t.r - d / 2 + 0.005, t.r + d / 2 - 0.005, M.drive));
    this.current = new TubView(cfg);
    this.next = new TubView(cfg);
    this.group.add(this.current.group, this.next.group);
    const l = label('Nest', 'label feeder');
    l.position.copy(local(t.a + 0.3, t.floor + 0.12, t.r));
    this.tubLabel = l.element;
    this.group.add(l);
    const name = label(`${c.denest.id} ${c.denest.name}`, 'label feeder');
    name.position.copy(local(t.a, cfg.layout.z.safe + 0.25, t.r));
    this.group.add(name);

    // EM00's gantry, turned so its travel axis runs outward from the fill point over the tub.
    const h = denestHeights(cfg);
    const far = t.r + (t.rows * t.pitch) / 2 - col.fill;
    const reach = { aMin: -0.07, aMax: far + 0.07, rMin: -0.12, rMax: (t.cols * t.pitch) / 2 + 0.07 };
    this.robot = new RobotView(reach, reach.rMax + 0.06, h.tub, cfg, models, 1, false);
    this.robot.group.position.copy(local(0, 0, col.fill));
    this.robot.group.rotation.y = Math.PI / 2;
    this.group.add(this.robot.group);
  }

  private placeTub(tub: TubView, da: number, dy = 0): void {
    const t = this.cfg.cartridges.tub;
    tub.group.position.copy(local(t.a + da, dy, t.r));
  }

  update(fa: Frame, fb: Frame, alpha: number): void {
    const c = this.cfg.cartridges;
    const f = fa.cartridges;
    const n = tubSize(this.cfg);
    // A change slides the empty tub out (-a) while the next full one slides in from +a.
    const k = f.changing > 0 ? 1 - f.changing / c.tub.change : 0;
    this.placeTub(this.current, f.changing > 0 ? -0.3 * k : 0);
    this.current.fill(n - f.used);
    this.placeTub(this.next, f.changing > 0 ? 0.3 * (1 - k) : 0.3);
    this.next.fill(n);
    this.tubLabel.textContent = f.changing > 0 ? 'Nest change' : `Nest: ${n - f.used}/${n} left`;

    const ra = f.robot;
    const rb = fb.cartridges.robot;
    this.robot.update([{ ...ra, a: lerp(ra.a, rb.a, alpha), r: lerp(ra.r, rb.r, alpha), z: lerp(ra.z, rb.z, alpha) }], false);

    const L = colletLoopLength(this.cfg);
    this.collets.forEach((x, i) => {
      const [ua, full] = f.collets[i] ?? [0, 0];
      // Interpolate along the loop, the short way round.
      let ub = fb.cartridges.collets[i]?.[0] ?? ua;
      if (ub - ua > L / 2) ub -= L;
      if (ua - ub > L / 2) ub += L;
      const q = colletPoint(this.cfg, lerp(ua, ub, alpha));
      x.root.position.copy(local(q.a, c.collets.base - 0.004, q.r));
      x.cart.visible = full === 1;
      x.cart.position.y = 0.004;
    });
  }
}
