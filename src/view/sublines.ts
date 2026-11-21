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
import { batch, block, finish, hardware, hose, plate, profile, round, visionCamera } from './hardware';
import { contactPatch } from './hall';
import { CLEAR } from './clear';
import { FeederView, RobotView, ringLight } from './devices';
import { miniConveyor } from './conveyor';
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
  private readonly status: HTMLElement;
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

    // EM13: a rotary unit with a turning chuck at the start of the conveyor, a camera over it on
    // a bracket, and the reject tote on the inner side.
    const orienter = new THREE.Group();
    block(orienter, 0, (TABLE + y - 0.012) / 2, -d.r, 0.05, y - 0.012 - TABLE, 0.05, finish.powder);
    block(orienter, 0, y - 0.009, -d.r, 0.056, 0.008, 0.056, finish.graphite);
    block(orienter, 0, TABLE + 0.004, -d.r, 0.08, 0.008, 0.08, finish.graphite);
    for (const dx of [-0.03, 0.03]) for (const dz of [-0.03, 0.03]) round(orienter, dx, TABLE + 0.0085, -d.r + dz, 0.0035, 0.001, finish.zinc, 10);
    block(orienter, 0.0255, y - 0.05, -d.r, 0.002, 0.03, 0.03, M.rail);
    plate(orienter, 0, y - 0.05, -d.r + 0.0256, 0.042, 0.014, 'EM13', 'ROTATE / CHECK');
    hose(
      orienter,
      [
        [0.026, y - 0.03, -d.r - 0.012],
        [0.04, y - 0.05, -d.r - 0.02],
        [0.045, TABLE + 0.04, -d.r - 0.03],
        [0.06, TABLE + 0.003, -d.r - 0.05],
      ],
      0.0028,
    );
    profile(orienter, [-0.07, TABLE, -d.r], [-0.07, y + 0.105, -d.r], 0.025);
    profile(orienter, [-0.0825, y + 0.1175, -d.r], [0.012, y + 0.1175, -d.r], 0.025);
    contactPatch(orienter, 0, TABLE + 0.0009, -d.r, 0.16, 0.16);
    batch(orienter);
    this.group.add(orienter);
    const chuckBody = cyl(0.012, 0.006, M.axis, 20);
    chuckBody.position.y = -0.003;
    this.chuck.add(chuckBody);
    this.chuckPart = models.spring_base.clone(true);
    this.chuck.add(this.chuckPart);
    this.chuck.position.copy(local(0, y, d.r));
    this.group.add(this.chuck);
    this.ring = ringLight();
    const cam = visionCamera(0.03, this.ring);
    cam.position.copy(local(0, y + 0.068, d.r));
    this.group.add(cam);
    // Reject chute on the inner side of the chuck.
    const collector = hardware('Tote', 0, TABLE, -d.r + 0.086);
    collector.scale.set(0.24, 0.43, 0.31);
    this.group.add(collector);
    const l = label(`${o.id} rejects: 0`, 'label bin');
    l.position.copy(local(0, y + 0.02, d.r - 0.075));
    this.rejects = l.element;
    this.group.add(l);
    const name = label(`${o.id} ${o.name}`, 'label feeder');
    name.position.copy(local(0, y + 0.14, d.r));
    this.status = name.element;
    this.group.add(name);

    // Distribution conveyor: a narrow belt conveyor on stands, guided either side, with an
    // opening at each cup where the diverter pushes a part across.
    const cupsAt = d.stations.map((id) => cfg.stations.find((s) => s.id === id)!.s - d.from);
    const conveyor = miniConveyor({
      a0: 0.03,
      a1: length + 0.006,
      r: d.r,
      y,
      width: 0.024,
      frame: 0.03,
      guide: {
        gap: 0.0125,
        height: 0.0065,
        openings: cupsAt.flatMap((a) => [
          { a, side: -1 as const, width: 0.02 },
          { a, side: 1 as const, width: 0.02 },
        ]),
      },
      legs: [0.13, ...cupsAt.slice(0, -1).map((a) => a + 0.135), length - 0.03],
      drive: { end: 1, side: 1, scale: 0.55 },
    });
    this.group.add(conveyor);
    const lane = new THREE.Group();
    // End stop where parts nobody takes queue.
    block(lane, length + 0.009, y + 0.006, -d.r, 0.006, 0.012, 0.03, finish.graphite);
    plate(lane, 0.29, y - 0.017, -d.r + 0.0212, 0.13, 0.021, 'EM13', 'SPRING BASE FEED');
    batch(lane);
    this.group.add(lane);

    // At each press: a nest block (the pick cup) beside the conveyor on an arm from a post, a
    // transfer plate between them, and a compact cylinder on the far side that pushes a part across.
    for (const a of cupsAt) {
      const unit = new THREE.Group();
      const postR = d.r + 0.045;
      profile(unit, [a, TABLE, -postR], [a, y - 0.05, -postR], 0.025);
      block(unit, a, TABLE + 0.004, -postR, 0.05, 0.008, 0.05, finish.graphite);
      contactPatch(unit, a, TABLE + 0.0009, -postR, 0.09, 0.09);
      block(unit, a, y - 0.042, -(postR + d.cupR) / 2, 0.026, 0.008, postR - d.cupR + 0.02, M.frame);
      block(unit, a, y - 0.019, -d.cupR, 0.026, 0.038, 0.026, M.frame);
      block(unit, a, y - 0.0005, -d.cupR, 0.0275, 0.001, 0.0275, finish.graphite);
      round(unit, a, y + 0.0001, -d.cupR, 0.0058, 0.0004, finish.seal, 20);
      block(unit, a, y - 0.0012, -(d.cupR + 0.013 + (d.r - 0.016 - d.cupR - 0.013) / 2), 0.02, 0.0024, d.r - 0.016 - d.cupR - 0.013, M.rail);
      block(unit, a + 0.016, y - 0.02, -d.cupR, 0.006, 0.01, 0.012, M.camera);
      const cylR = d.r + 0.042;
      block(unit, a, y + 0.006, -cylR, 0.02, 0.016, 0.034, M.axisDark);
      block(unit, a, y - 0.006, -cylR, 0.026, 0.008, 0.04, M.frame);
      block(unit, a, y - 0.025, -(postR - 0.004), 0.02, 0.03, 0.004, M.frame);
      for (const dr of [-0.008, 0.01]) {
        round(unit, a + 0.011, y + 0.008, -(cylR + dr), 0.0024, 0.004, finish.zinc, 12).rotation.z = Math.PI / 2;
        round(unit, a + 0.0135, y + 0.008, -(cylR + dr), 0.0029, 0.002, finish.pipe, 12).rotation.z = Math.PI / 2;
      }
      hose(
        unit,
        [
          [a + 0.014, y + 0.008, -(cylR - 0.008)],
          [a + 0.03, y + 0.004, -(cylR - 0.004)],
          [a + 0.036, y - 0.04, -(postR + 0.006)],
          [a + 0.03, 0.06, -(postR + 0.02)],
          [a + 0.022, TABLE + 0.004, -(postR + 0.035)],
        ],
        0.0022,
        finish.pipe,
      );
      batch(unit);
      this.group.add(unit);
      const part = models.spring_base.clone(true);
      part.position.copy(local(a, y, d.cupR));
      this.group.add(part);
      const pusher = new THREE.Group();
      pusher.add(span(-0.008, 0.008, y + 0.0035, y + 0.0085, -0.002, 0.002, M.rail));
      pusher.add(span(-0.0025, 0.0025, y + 0.0045, y + 0.0075, 0.002, 0.03, M.rail));
      pusher.position.x = a;
      pusher.position.z = -d.r - 0.025;
      this.group.add(pusher);
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
    const fault = f.alarms.orienter;
    this.status.classList.toggle('jam', fault > 0);
    this.status.textContent = fault > 0 ? `${this.cfg.orienter.id}: FAULT (${Math.ceil(fault)} s)` : `${this.cfg.orienter.id} ${this.cfg.orienter.name}`;

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
  private readonly applicatorPad: THREE.Group;
  private readonly ring: THREE.MeshStandardMaterial;
  private readonly ejector: THREE.Group;
  private readonly rejects: HTMLElement;
  private readonly status: HTMLElement;
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
    const foundation = new THREE.Group();
    const column = hardware('Indexer', d.a, TABLE, -d.r);
    column.scale.set(1.2, (y - 0.014 - TABLE) / 0.136, 1.2);
    foundation.add(column);
    contactPatch(foundation, d.a, TABLE + 0.0009, -d.r, 0.33, 0.32);
    plate(foundation, d.a, TABLE + 0.071, -d.r + 0.086, 0.098, 0.03, 'RD 08', 'CAM INDEX UNIT');
    const cover = new THREE.Shape();
    cover.absarc(0, 0, d.radius + 0.025, 0, Math.PI * 2, false);
    for (let i = 0; i < d.nests; i++) {
      const [a, r] = this.at(i, 0);
      const cut = new THREE.Path();
      cut.absarc(a - d.a, r - d.r, 0.013, 0, Math.PI * 2, true);
      cover.holes.push(cut);
    }
    const discGeometry = new THREE.ExtrudeGeometry(cover, {
      depth: 0.012,
      bevelEnabled: true,
      bevelThickness: 0.0007,
      bevelSize: 0.0007,
      bevelSegments: 1,
      curveSegments: 48,
    });
    discGeometry.rotateX(-Math.PI / 2);
    const rotary = new THREE.Group();
    const platter = new THREE.Mesh(discGeometry, M.frame);
    platter.position.y = -0.013;
    rotary.add(platter);
    round(rotary, 0, -0.015, 0, d.radius + 0.02, 0.009, finish.graphite, 64);
    round(rotary, 0, 0.001, 0, 0.05, 0.005, finish.graphite, 48);
    round(rotary, 0, 0.004, 0, 0.038, 0.004, M.rail, 48);
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const x = 0.043 * Math.cos(angle),
        z = 0.043 * Math.sin(angle);
      round(rotary, x, 0.004, z, 0.003, 0.003, M.rail, 12);
      round(rotary, x, 0.0056, z, 0.0016, 0.0004, finish.seal, 6);
    }
    // Nest bushings with a chamfered lead-in, two retaining screws and a seat inside the bore.
    const bushing = new THREE.LatheGeometry(
      [
        [0.0092, -0.001],
        [0.0092, 0.0055],
        [0.0104, 0.0068],
        [0.0166, 0.0068],
        [0.0176, 0.0058],
        [0.0176, -0.001],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      40,
    );
    for (let i = 0; i < d.nests; i++) {
      const [a, r] = this.at(i, 0);
      const x = a - d.a;
      const z = -(r - d.r);
      const nest = new THREE.Mesh(bushing, M.rail);
      nest.position.set(x, 0, z);
      rotary.add(nest);
      round(rotary, x, -0.0008, z, 0.0092, 0.0016, finish.graphite, 24);
      round(rotary, x, -0.011, z, 0.012, 0.005, finish.seal);
      const out = Math.atan2(z, x);
      for (const da of [-1.25, 1.25]) round(rotary, x + 0.0137 * Math.cos(out + da), 0.0071, z + 0.0137 * Math.sin(out + da), 0.0017, 0.0008, finish.zinc, 10);
      // Two rim bolts in each gap between nests.
      for (const off of [-0.18, 0.18]) {
        const ang = out + Math.PI / d.nests + off;
        round(rotary, 0.153 * Math.cos(ang), 0.0001, 0.153 * Math.sin(ang), 0.0032, 0.0012, finish.zinc, 12);
        round(rotary, 0.153 * Math.cos(ang), 0.0008, 0.153 * Math.sin(ang), 0.0016, 0.0003, finish.seal, 6);
      }
    }
    // Engraved position numbers and index ticks, inboard of the nests.
    const marks = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.124, 64).rotateX(-Math.PI / 2), dialMarks(d.nests, (i) => this.at(i, 0), d.a, d.r));
    marks.position.y = 0.0003;
    rotary.add(marks);
    this.disc.position.copy(local(d.a, y, d.r));
    batch(rotary);
    batch(foundation);
    this.disc.add(rotary);
    this.group.add(foundation, this.disc);

    for (let i = 0; i < d.nests; i++) {
      const h = housingPart(models);
      h.visible = false;
      this.housings.push(h);
      this.group.add(h);
    }

    // EM31: print-and-apply unit on a post: base plate, print module, label roll and liner
    // rewind, peel plate, and a pad that presses the label on.
    const [la, lr] = this.at(d.positions.label, 0.055);
    const applicator = new THREE.Group();
    block(applicator, 0, 0.068, 0.008, 0.084, 0.124, 0.008, M.frame);
    block(applicator, 0, 0.048, -0.007, 0.056, 0.054, 0.022, M.camera);
    block(applicator, 0, 0.074, -0.0181, 0.044, 0.002, 0.0002, finish.zinc);
    block(applicator, 0, 0.032, -0.024, 0.03, 0.0025, 0.014, finish.zinc);
    const labelStock = mat(0xf3f2ec, { roughness: 0.62 });
    for (const [x, rad, m] of [
      [-0.014, 0.026, labelStock],
      [0.026, 0.015, mat(0xc9b48d, { roughness: 0.7 })],
    ] as const) {
      round(applicator, x, 0.104, -0.006, rad, 0.012, m, 32).rotation.x = Math.PI / 2;
      round(applicator, x, 0.104, -0.006, 0.0075, 0.016, finish.graphite, 16).rotation.x = Math.PI / 2;
      round(applicator, x, 0.104, -0.0125, rad + 0.002, 0.0015, M.rail, 32).rotation.x = Math.PI / 2;
    }
    for (const [x, yy] of [
      [0.01, 0.082],
      [-0.03, 0.078],
    ])
      round(applicator, x, yy, -0.006, 0.004, 0.016, M.rail, 16).rotation.x = Math.PI / 2;
    plate(applicator, 0, 0.0115, 0.0122, 0.052, 0.016, 'EM31', 'PRINT / APPLY');
    batch(applicator);
    this.applicatorPad = new THREE.Group();
    this.applicatorPad.add(span(-0.012, 0.012, 0.03, 0.058, -0.031, -0.02, M.axis));
    this.applicatorPad.add(span(-0.011, 0.011, 0.031, 0.057, -0.035, -0.031, finish.seal));
    applicator.add(this.applicatorPad);
    applicator.position.copy(local(la, y, lr));
    // Facing the dial centre.
    applicator.rotation.set(0, Math.atan2(la - d.a, -(lr - d.r)) + Math.PI, 0);
    const stand = new THREE.Group();
    profile(stand, [la, TABLE, -lr], [la, y + 0.004, -lr], 0.04);
    stand.add(hardware('ColumnShoe', la, TABLE, -lr));
    contactPatch(stand, la, TABLE + 0.0009, -lr, 0.12, 0.12);
    // EM32: camera on a profile post outside the dial, looking level at the label.
    const [ca, cr] = this.at(d.positions.inspect, 0.08);
    const [pa, pr] = this.at(d.positions.inspect, 0.115);
    profile(stand, [pa, TABLE, -pr], [pa, y + 0.07, -pr], 0.025);
    const shoe = hardware('ColumnShoe', pa, TABLE, -pr);
    shoe.scale.setScalar(0.62);
    stand.add(shoe);
    contactPatch(stand, pa, TABLE + 0.0009, -pr, 0.08, 0.08);
    batch(stand);
    this.group.add(applicator, stand);
    this.ring = ringLight();
    const cam = new THREE.Group();
    const head = visionCamera(0.03, this.ring);
    head.rotation.x = -Math.PI / 2;
    cam.add(head);
    // Bracket from the post to the camera housing.
    cam.add(span(-0.006, 0.006, 0.018, 0.024, -0.045, 0.002, M.frame));
    cam.position.copy(local(ca, y + 0.045, cr));
    cam.rotation.set(0, Math.atan2(ca - d.a, -(cr - d.r)), 0);
    this.group.add(cam);

    // Stationary centre plate over the hub, carrying the eject cylinder aimed at the eject
    // position; its rod and pad push a rejected housing off into the bin outside the dial.
    const [ea, er] = this.at(d.positions.eject, 0);
    const ejectAngle = Math.atan2(er - d.r, ea - d.a);
    const centre = new THREE.Group();
    round(centre, 0, 0.02, 0, 0.018, 0.03, M.frame, 32);
    round(centre, 0, 0.039, 0, 0.068, 0.008, M.frame, 48);
    round(centre, 0, 0.0435, 0, 0.066, 0.001, finish.graphite, 48);
    for (let i = 0; i < 6; i++) round(centre, 0.055 * Math.cos((i * Math.PI) / 3 + 0.3), 0.0439, 0.055 * Math.sin((i * Math.PI) / 3 + 0.3), 0.003, 0.001, finish.zinc, 10);
    const body = new THREE.Group();
    block(body, 0.039, 0.0545, 0, 0.038, 0.018, 0.022, M.axisDark);
    block(body, 0.059, 0.0545, 0, 0.004, 0.02, 0.024, M.frame);
    block(body, 0.019, 0.0545, 0, 0.004, 0.02, 0.024, M.frame);
    for (const x of [0.026, 0.052]) {
      round(body, x, 0.0655, 0, 0.0024, 0.004, finish.zinc, 12);
      round(body, x, 0.0685, 0, 0.0029, 0.002, finish.pipe, 12);
    }
    body.rotation.y = ejectAngle;
    centre.add(body);
    centre.position.copy(local(d.a, y, d.r));
    batch(centre);
    this.group.add(centre);
    this.ejector = new THREE.Group();
    const rod = round(this.ejector, 0.064, 0.0545, 0, 0.003, 0.074, M.rail, 16);
    rod.rotation.z = Math.PI / 2;
    this.ejector.add(span(0.1, 0.104, 0.046, 0.063, -0.008, 0.008, M.axis));
    this.ejector.rotation.y = ejectAngle;
    this.ejector.position.copy(local(d.a, y, d.r));
    this.ejector.userData.home = this.ejector.position.clone();
    this.ejector.userData.out = new THREE.Vector3(Math.cos(ejectAngle), 0, -Math.sin(ejectAngle)).multiplyScalar(0.03);
    const [ba, br] = this.at(d.positions.eject, 0.11);
    const bin = new THREE.Group();
    const tote = hardware('Tote', 0, TABLE, 0);
    tote.scale.set(0.36, 0.65, 0.36);
    bin.add(tote);
    bin.position.copy(local(ba, 0, br));
    this.group.add(this.ejector, bin);
    const l = label(`${d.inspect.id} rejects: 0`, 'label bin');
    l.position.copy(local(ba, y, br));
    this.rejects = l.element;
    this.group.add(l);
    const name = label(`${d.load.id}–${d.inspect.id} housing dial`, 'label feeder');
    name.position.copy(local(d.a, y + 0.24, d.r));
    this.status = name.element;
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
      h.rotation.y = Math.atan2(a - d.a, -(r - d.r));
      showLabel(h, labels[pos] ?? null);
    });
    this.applicatorPad.position.z = active.label && Math.floor(t * 4) % 2 === 0 ? -0.012 : 0;
    this.ring.emissiveIntensity = active.inspect && Math.floor(t * 8) % 2 === 0 ? 2.5 : 0.2;
    const home = this.ejector.userData.home as THREE.Vector3;
    this.ejector.position.copy(home);
    if (active.eject) this.ejector.position.add(this.ejector.userData.out as THREE.Vector3);
    this.rejects.textContent = `${d.inspect.id} rejects: ${f.counters.bins[d.inspect.id] ?? 0}`;
    // The dial's state: jammed, waiting for a new label roll, or labels left on the roll.
    const { dialJam, labelRoll } = f.alarms;
    const alarm = dialJam > 0 || labelRoll > 0;
    this.status.classList.toggle('jam', alarm);
    this.status.textContent =
      dialJam > 0
        ? `Housing dial: JAM (${Math.ceil(dialJam)} s)`
        : labelRoll > 0
          ? `${d.label.id}: label roll change (${Math.ceil(labelRoll)} s)`
          : `${d.load.id}–${d.inspect.id} housing dial · roll ${f.dial.roll}`;
  }
}

/** A tub (nest) of cartridges: white tray with pockets, cartridges drawn as one instanced mesh. */
class TubView {
  readonly group = new THREE.Group();
  private readonly carts: THREE.InstancedMesh;
  private readonly drug: THREE.InstancedMesh;
  private readonly caps: THREE.InstancedMesh;
  private shown = -1;

  constructor(private readonly cfg: LineConfig) {
    this.group.userData.mobile = true;
    const t = cfg.cartridges.tub;
    const w = t.cols * t.pitch + 0.012;
    const d = t.rows * t.pitch + 0.012;
    this.group.add(span(-w / 2, w / 2, t.floor - 0.012, t.floor, -d / 2, d / 2, M.nest));
    const len = cfg.parts.cartridge.length;
    const geo = new THREE.CylinderGeometry(cfg.parts.cartridge.radius, cfg.parts.cartridge.radius, len - 0.006, 12, 1, true);
    geo.translate(0, (len - 0.006) / 2, 0);
    this.carts = new THREE.InstancedMesh(geo, CLEAR.Glass, tubSize(cfg));
    const drug = new THREE.CylinderGeometry(cfg.parts.cartridge.radius - 0.0006, cfg.parts.cartridge.radius - 0.0006, 0.05, 10);
    drug.translate(0, 0.031, 0);
    this.drug = new THREE.InstancedMesh(drug, CLEAR.Drug, tubSize(cfg));
    const caps = new THREE.CylinderGeometry(0.0042, 0.0042, 0.006, 12);
    caps.translate(0, len - 0.003, 0);
    this.caps = new THREE.InstancedMesh(caps, M.rail, tubSize(cfg));
    this.caps.castShadow = true;
    this.group.add(this.carts, this.drug, this.caps);
    const rim = new THREE.Group();
    for (const x of [-w / 2, w / 2]) block(rim, x, t.floor + 0.008, 0, 0.005, 0.022, d + 0.006, M.nest);
    for (const z of [-d / 2, d / 2]) block(rim, 0, t.floor + 0.008, z, w, 0.022, 0.005, M.nest);
    batch(rim);
    this.group.add(rim);
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
      this.drug.setMatrixAt(i, m);
      this.caps.setMatrixAt(i, m);
    }
    this.carts.instanceMatrix.needsUpdate = true;
    this.drug.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
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
    const transfer = new THREE.Group();
    // Carrier return with two semicircular ends under the collet path.
    const rad = col.radius + 0.016;
    const start = col.pick + col.radius,
      end = col.fill - col.radius;
    const outline = new THREE.Shape();
    outline.absarc(0, start, rad, Math.PI, 2 * Math.PI, false);
    outline.lineTo(rad, end);
    outline.absarc(0, end, rad, 0, Math.PI, false);
    outline.closePath();
    const chassis = new THREE.ExtrudeGeometry(outline, {
      depth: 0.018,
      bevelEnabled: true,
      bevelSize: 0.0015,
      bevelThickness: 0.0015,
      bevelSegments: 1,
    });
    chassis.rotateX(-Math.PI / 2);
    const bed = new THREE.Mesh(chassis, finish.graphite);
    bed.position.y = col.base - 0.03;
    transfer.add(bed);
    // Sprocket wheels under each end, on a profile stand with foot plates and cross members,
    // and the gearmotor hanging under the fill end.
    const under = col.base - 0.03;
    for (const r of [start, end]) {
      round(transfer, 0, under - 0.011, -r, 0.05, 0.016, finish.graphite, 32);
      round(transfer, 0, under - 0.002, -r, 0.022, 0.004, M.rail, 24);
      for (const a of [-0.042, 0.042]) {
        profile(transfer, [a, TABLE + 0.008, -r], [a, under - 0.019, -r], 0.03);
        block(transfer, a, TABLE + 0.004, -r, 0.055, 0.008, 0.055, finish.graphite);
        for (const dz of [-0.019, 0.019]) round(transfer, a + 0.019, TABLE + 0.0085, -r + dz, 0.0032, 0.001, finish.zinc, 10);
      }
      block(transfer, 0, under - 0.025, -r, 0.115, 0.012, 0.03, finish.graphite);
      contactPatch(transfer, 0, TABLE + 0.0009, -r, 0.17, 0.1);
    }
    for (const a of [-0.042, 0.042]) profile(transfer, [a, TABLE + 0.04, -start], [a, TABLE + 0.04, -end], 0.025);
    const gear = hardware('Gearmotor', 0.012, under - 0.06, -end);
    gear.scale.setScalar(0.38);
    gear.rotation.z = -Math.PI / 2;
    transfer.add(gear);
    plate(transfer, 0, col.base - 0.021, -(start - rad - 0.002), 0.061, 0.012, 'CF12', 'COLLET FEED');
    batch(transfer);
    this.group.add(transfer);
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
    const conveyor = new THREE.Group();
    const middle = t.a + 0.075;
    for (const r of [t.r - d / 2 + 0.012, t.r + d / 2 - 0.012]) {
      profile(conveyor, [t.a - 0.35, t.floor - 0.041, -r], [t.a + 0.5, t.floor - 0.041, -r], 0.04);
      block(conveyor, middle, t.floor - 0.018, -r, 0.85, 0.012, 0.031, M.drive);
      for (const a of [t.a - 0.29, t.a + 0.18, t.a + 0.44]) {
        profile(conveyor, [a, TABLE, -r], [a, t.floor - 0.058, -r], 0.025);
        block(conveyor, a, TABLE + 0.003, -r, 0.054, 0.006, 0.049, finish.graphite);
      }
      for (const a of [t.a - 0.35, t.a + 0.5]) block(conveyor, a, t.floor - 0.04, -r, 0.007, 0.041, 0.042, M.axisDark);
    }
    for (const a of [t.a - 0.29, t.a + 0.44]) profile(conveyor, [a, t.floor - 0.069, -t.r + d / 2], [a, t.floor - 0.069, -t.r - d / 2], 0.025);
    const drive = hardware('Servo', t.a + 0.44, t.floor - 0.042, -t.r + d / 2);
    drive.rotation.y = -Math.PI / 2;
    conveyor.add(drive);
    plate(conveyor, middle, t.floor - 0.041, -t.r + d / 2 + 0.011, 0.11, 0.028, 'EM00', 'CARTRIDGE NESTS');
    batch(conveyor);
    this.group.add(conveyor);
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

/** Position numbers and index ticks engraved round a dial plate (a ring decal, transparent). */
function dialMarks(nests: number, at: (i: number) => [number, number], ca: number, cr: number): THREE.Material {
  const S = 512;
  const R = 0.124;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const p = c.getContext('2d')!;
  p.fillStyle = 'rgba(40,46,48,0.85)';
  p.strokeStyle = 'rgba(40,46,48,0.85)';
  p.textAlign = 'center';
  p.textBaseline = 'middle';
  p.font = 'bold 30px Arial';
  for (let i = 0; i < nests; i++) {
    const [a, r] = at(i);
    // Rotary-local three coordinates (x along a, z = -r) → canvas (see RingGeometry's UVs).
    const x = a - ca;
    const z = -(r - cr);
    const ang = Math.atan2(z, x);
    const px = (u: number) => S * (0.5 + (u * Math.cos(ang)) / (2 * R));
    const pz = (u: number) => S * (0.5 + (u * Math.sin(ang)) / (2 * R));
    p.save();
    p.translate(px(0.105), pz(0.105));
    p.rotate(ang - Math.PI / 2);
    p.fillText(String(i + 1), 0, 0);
    p.restore();
    p.lineWidth = 3;
    p.beginPath();
    p.moveTo(px(0.115), pz(0.115));
    p.lineTo(px(0.123), pz(0.123));
    p.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.5, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
}
