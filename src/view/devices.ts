// Views of station equipment, each drawn in its station's local coordinates from frame data.
import * as THREE from 'three';
import type { FeederDef, LineConfig, PartType } from '../sim/config';
import { gripRadius, heldLength, trayPocket } from '../sim/layout';
import type { Frame, RobotFrame } from '../sim/protocol';
import { M, RAIL_Y, type Reach, TABLE, cyl, label, local, mat, span } from './build';
import type { Models } from './models';
import { StockInstances, batch, block, finish, gland, hardware, hose, plate, profile, round, visionCamera } from './hardware';
import { contactPatch } from './hall';
import { miniConveyor } from './conveyor';
import { AssemblyView, HeldView, housingPart } from './movers';
import { BOWL, RAMP_R, dischargeAt, floorProfile, housingBowlLayout, laneAt, measureHousing } from './bowl';

/** Ring light diffuser brightness: always on (as most are), and flashed while exposing. */
export const RING_IDLE = 1.1;
export const RING_FLASH = 2.8;
/** A ring light's diffuser: lit, and flashed brighter while its camera exposes. */
export function ringLight(): THREE.MeshStandardMaterial {
  return mat(0xf4f8fa, { emissive: 0xd8eeff, emissiveIntensity: RING_IDLE, roughness: 0.3 });
}

/** Folded energy chain. Both horizontal runs and the semicircular return
 * share one constant length as the carriage travels. */
class CableCarrier {
  readonly links: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly radius=.022;
  private readonly anchor:number;
  private readonly length:number;
  constructor(private readonly height:number, rMin:number, beamR:number) {
    this.anchor=-(rMin+beamR)/2;
    this.length=(beamR-rMin)/2+Math.PI*this.radius+.085;
    const count=Math.ceil(this.length/.014);
    this.links=new THREE.InstancedMesh(new THREE.BoxGeometry(.021,.011,this.length/count*.89),finish.seal,count);
    this.links.frustumCulled=false;
    this.links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  travel(z:number):void {
    const arc=Math.PI*this.radius;
    const bend=(this.anchor+z-this.length+arc)/2;
    const lead=this.anchor-bend;
    for(let i=0;i<this.links.count;i++){
      const d=this.length*(i+.5)/this.links.count-lead;
      let y=this.height, at=this.anchor, angle=0;
      if(d<0)at=bend-d;
      else if(d<arc){
        angle=d/this.radius;
        at=bend-this.radius*Math.sin(angle);
        y+=this.radius*(1-Math.cos(angle));
      }else { at=bend+d-arc; y+=2*this.radius; }
      this.matrix.makeRotationX(angle).setPosition(-.064,y,at);
      this.links.setMatrixAt(i,this.matrix);
    }
    this.links.instanceMatrix.needsUpdate=true;
  }
}

/** One arm of a gantry: travels along the beam (a), with a carriage (r) and a z column with the gripper. */
class ArmView {
  readonly arm = new THREE.Group();
  private readonly carriage = new THREE.Group();
  private readonly column = new THREE.Group();
  private readonly rod: THREE.Object3D;
  private readonly carrier: CableCarrier;
  private readonly glandY: number;
  private readonly held: HeldView;
  private readonly fingers: THREE.Object3D[] = [];

  constructor(
    rMin: number,
    beamR: number,
    lowestTip: number,
    private readonly cfg: LineConfig,
    models: Models,
    private readonly payload: PartType,
  ) {
    this.arm.userData.mobile = true;
    const top = RAIL_Y + 0.02;
    // The actuator is side mounted to the radial slide. Its piston can
    // retract fully into the barrel without crossing the radial beam.
    const axis = new THREE.Group();
    // Carriage on the beam: anodised body with end seals, a machined top plate and its screws.
    block(axis, -0.041, top + 0.001, -beamR, 0.103, 0.026, 0.072, M.axisDark);
    for (const dx of [-0.054, 0.054]) block(axis, -0.041 + dx, top + 0.001, -beamR, 0.006, 0.022, 0.068, finish.seal);
    block(axis, -0.041, top + 0.018, -beamR, 0.109, 0.008, 0.074, M.frame);
    for (const dx of [-0.042, 0.042]) for (const dz of [-0.028, 0.028]) round(axis, -0.041 + dx, top + 0.0225, -beamR + dz, 0.0035, 0.0012, finish.zinc, 12);
    profile(axis, [-0.048, top + 0.044, -beamR - 0.04], [-0.048, top + 0.044, -rMin], 0.045);
    block(axis, -0.022, top + 0.042, -(beamR + rMin) / 2, 0.009, 0.016, beamR - rMin + 0.04, M.rail);
    const servo = hardware('Servo', -0.048, top + 0.044, -beamR - 0.044);
    servo.rotation.y = Math.PI / 2;
    axis.add(servo);
    for (const z of [-rMin, -beamR - 0.04]) block(axis, -0.048, top + 0.044, z, 0.049, 0.052, 0.008, M.axisDark);
    const anchorZ = -(rMin + beamR) / 2;
    block(axis, -0.064, top + 0.071, anchorZ, 0.025, 0.014, 0.032, finish.graphite);
    // Servo lead is captured along the radial beam up to the fixed chain end.
    hose(
      axis,
      [
        [-0.048, top + 0.081, -beamR - 0.117],
        [-0.068, top + 0.087, -beamR - 0.13],
        [-0.078, top + 0.064, -beamR - 0.08],
        [-0.074, top + 0.06, anchorZ - 0.028],
        [-0.064, top + 0.071, anchorZ],
      ],
      0.0028,
    );
    batch(axis);
    this.arm.add(axis);
    this.carrier = new CableCarrier(top + 0.079, rMin, beamR);
    this.arm.add(this.carrier.links);
    const slide = new THREE.Group();
    this.glandY = cfg.layout.z.safe + 0.117;
    const stroke = cfg.layout.z.safe - lowestTip + 0.024;
    const cylinder = hardware('Cylinder', 0, this.glandY, 0);
    cylinder.scale.set(0.83, stroke / 0.135, 0.83);
    slide.add(cylinder);
    block(slide, -0.017, top + 0.032, 0, 0.037, 0.052, 0.062, M.axisDark);
    block(slide, 0.0025, top + 0.032, 0, 0.002, 0.044, 0.054, M.frame);
    for (const dy of [-0.015, 0.015]) for (const dz of [-0.021, 0.021]) round(slide, 0.004, top + 0.032 + dy, dz, 0.0028, 0.002, finish.zinc, 10).rotation.z = Math.PI / 2;
    for (const z of [-0.025, 0.025]) block(slide, -0.028, top + 0.033, z, 0.018, 0.028, 0.019, M.rail);
    hose(
      slide,
      [
        [0.032, this.glandY + stroke * 0.2, 0],
        [0.046, this.glandY + 0.04, 0],
        [0.046, top + 0.08, -0.023],
        [0, top + 0.12, -0.038],
        [-0.064, top + 0.12, 0],
      ],
      0.0034,
      finish.pipe,
    );
    hose(
      slide,
      [
        [0.032, this.glandY + stroke * 0.837, 0],
        [0.038, this.glandY + stroke * 0.84, 0.015],
        [0.039, top + 0.102, 0.023],
        [-0.064, top + 0.117, 0.01],
      ],
      0.0028,
    );
    block(slide, -0.064, top + 0.121, 0, 0.025, 0.014, 0.033, finish.graphite);
    block(slide, -0.042, top + 0.118, 0, 0.043, 0.008, 0.018, M.frame);
    block(slide, -0.023, top + 0.09, 0, 0.008, 0.06, 0.018, M.frame);
    batch(slide);
    this.carriage.add(slide);
    this.rod = hardware('GuidedRam');
    this.carriage.add(this.rod);
    const head = new THREE.Group();
    head.add(hardware('ToolFlange'));
    if (payload === 'spring' || payload === 'springBase') {
      head.add(hardware(payload === 'spring' ? 'SpringPilot' : 'PressPunch'));
    } else {
      const jaws = new THREE.Group();
      jaws.rotation.y = Math.PI / 7;
      this.column.add(jaws);
      const drive = new THREE.Group();
      drive.add(hardware('JawBody'));
      if (payload === 'cartridge') {
        // The jaws carry the glass barrel. A sprung pad on the crimp drives
        // the last few millimetres after the jaws clear the housing mouth.
        round(drive, 0, 0.029, 0, 0.005, 0.019, finish.graphite);
        round(drive, 0, 0.011, 0, 0.003, 0.021, M.rail);
        round(drive, 0, 0.001, 0, 0.0038, 0.002, finish.seal);
      }
      // Short pilot lines from the jaw ports to the drilled tool flange.
      for (const side of [-1, 1]) {
        hose(
          drive,
          [
            [side * 0.01, 0.058, -0.018],
            [side * 0.012, 0.058, -0.025],
            [side * 0.013, 0.075, -0.024],
            [side * 0.01, 0.086, -0.018],
          ],
          0.0017,
          finish.pipe,
        );
      }
      batch(drive);
      jaws.add(drive);
      for (const side of [1, -1]) {
        const finger = hardware(payload === 'cartridge' ? 'CartridgeJaw' : payload === 'body' ? 'TubeJaw' : 'BarrelJaw');
        if (side < 0) finger.rotation.y = Math.PI;
        this.fingers.push(finger);
        jaws.add(finger);
      }
    }
    batch(head);
    this.column.add(head);
    this.held = new HeldView(cfg, models);
    this.column.add(this.held.root);
    this.carriage.add(this.column);
    this.arm.add(this.carriage);
  }

  /** Names the arm's gripper column for the object oracle (see oracle.ts). */
  tag(id: string): void {
    this.column.userData.track = { cls: 'robot', id };
  }

  update(r: RobotFrame): void {
    this.arm.position.x = r.a;
    this.carriage.position.z = -r.r;
    this.column.position.y = r.z;
    const tip = r.z + 0.096;
    this.rod.scale.y = Math.max(0.001, this.glandY - tip);
    this.rod.position.y = tip;
    this.carrier.travel(-r.r);
    this.held.show(r.holding, r.label);
    // Jaws close on the held part's top; open a few mm wider when empty.
    if (this.fingers.length) {
      const radius = this.cfg.parts[this.payload].radius;
      let half = radius + 0.005;
      if (r.holding) half = r.holding.includes('housing') ? this.cfg.parts.housing.radius : gripRadius(this.cfg, r.holding);
      if (this.payload === 'cartridge' && Math.abs(r.r) < 0.001 && Math.abs(r.a) < 0.001) {
        const shell = this.cfg.parts.housing;
        const mouth = this.cfg.mover.seat + shell.seat + shell.length;
        const release = THREE.MathUtils.clamp((mouth + 0.040 - r.z) / 0.006, 0, 1);
        half = Math.max(half, radius + release * (shell.radius + 0.003 - radius));
      }
      this.fingers[0].position.x = half;
      this.fingers[1].position.x = -half;
    }
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
  readonly frame = new THREE.Group();
  private readonly arms: ArmView[];
  private readonly laser: THREE.Mesh | null = null;

  /**
   * `beamR`: where the beam and its legs stand, outside everything on the table below the robots.
   * `lowestTip`: the lowest gripper height the robots go to; the z columns stay in their carriage there.
   */
  constructor(
    reach: Reach,
    beamR: number,
    lowestTip: number,
    cfg: LineConfig,
    models: Models,
    payloads: PartType[],
    withLaser: boolean,
    press = false,
  ) {
    const { aMin, aMax, rMin } = reach;
    const top = RAIL_Y + 0.02;
    const frame = this.frame;
    profile(frame, [aMin - 0.035, top - 0.026, -beamR], [aMax + 0.035, top - 0.026, -beamR], 0.05);
    block(frame, (aMin + aMax) / 2, top - 0.007, -beamR + 0.026, aMax - aMin + 0.065, 0.014, 0.012, M.rail);
    for (let a = aMin; a <= aMax + 0.001; a += 0.052) {
      round(frame, a, top - 0.008, -beamR + 0.033, 0.0027, 0.002, finish.seal, 8).rotation.x = Math.PI / 2;
    }
    if (press) {
      const standard = hardware('PressStandard', (aMin + aMax) / 2, TABLE, -beamR - 0.026);
      standard.scale.y = (top - 0.052 - TABLE) / 0.486;
      frame.add(standard);
      // Hard-point clips hold the vertical run to the rear service door.
      const tubeZ = -beamR - 0.096;
      const tubeX = 0.021;
      gland(frame, tubeX, TABLE, tubeZ, 0.003);
      hose(
        frame,
        [
          [tubeX, TABLE + 0.003, tubeZ],
          [tubeX, 0.09, tubeZ],
          [tubeX, top - 0.09, tubeZ],
          [0.039, top - 0.054, tubeZ + 0.008],
          [0.039, top - 0.03, -beamR - 0.038],
        ],
        0.003,
        finish.pipe,
      );
      for (const y of [0.09, 0.32]) {
        block(frame, tubeX, y, tubeZ + 0.001, 0.014, 0.007, 0.012, finish.graphite);
        round(frame, tubeX - 0.004, y, tubeZ - 0.006, 0.0018, 0.002, finish.zinc, 8).rotation.x = Math.PI / 2;
      }
      // The air line ends in a flow-control block on the beam's back face.
      block(frame, 0.039, top - 0.03, -beamR - 0.031, 0.028, 0.03, 0.012, M.axisDark);
      round(frame, 0.039, top - 0.012, -beamR - 0.031, 0.004, 0.008, finish.zinc, 12);
    } else {
      for (const a of [aMin - 0.008, aMax + 0.008]) {
        profile(frame, [a, TABLE, -beamR], [a, top - 0.05, -beamR]);
        frame.add(hardware('ColumnShoe', a, TABLE, -beamR));
        contactPatch(frame, a, TABLE + 0.0009, -beamR, 0.12, 0.12);
      }
      for (const y of [0.014, 0.32]) block(frame, aMax + 0.026, y, -beamR - 0.023, 0.016, 0.009, 0.017, finish.graphite);
      // Raised cable entry with a bolted flange at the deck penetration.
      block(frame, aMax + 0.074, TABLE + 0.003, -beamR - 0.07, 0.035, 0.006, 0.026, M.frame);
      round(frame, aMax + 0.074, TABLE + 0.010, -beamR - 0.07, 0.008, 0.01, finish.zinc, 6);
      hose(
        frame,
        [
          [aMax + 0.117, top + 0.015, -beamR],
          [aMax + 0.132, top + 0.012, -beamR - 0.018],
          [aMax + 0.053, top - 0.078, -beamR - 0.024],
          [aMax + 0.026, 0.32, -beamR - 0.026],
          [aMax + 0.026, 0.014, -beamR - 0.026],
          [aMax + 0.074, TABLE + 0.016, -beamR - 0.07],
        ],
        0.005,
      );
    }
    for (const a of [aMin - 0.038, aMax + 0.038]) block(frame, a, top - 0.025, -beamR, 0.008, 0.056, 0.056, M.axisDark);
    const motor = hardware('Servo', aMax + 0.04, top - 0.025, -beamR);
    frame.add(motor);
    batch(frame);
    this.group.add(frame);
    this.arms = payloads.map((payload) => {
      const arm = new ArmView(rMin, beamR, lowestTip, cfg, models, payload);
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

  /** Names the robots of station `station` for the object oracle. */
  tag(station: string): void {
    this.arms.forEach((a, i) => a.tag(this.arms.length > 1 ? `${station}-${i + 1}` : station));
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
    const mast = new THREE.Group();
    profile(mast, [0, TABLE, -postR], [0, top, -postR], 0.035);
    mast.add(hardware('ColumnShoe', 0, TABLE, -postR));
    profile(mast, [0, top, -postR - 0.019], [0, top, 0.025], 0.031);
    block(mast, 0, top - 0.025, 0, 0.056, 0.019, 0.056, M.axisDark);
    hose(
      mast,
      [
        [0.022, top - 0.049, 0],
        [0.041, top + 0.024, 0.016],
        [0.026, top + 0.029, -0.108],
        [0.027, top + 0.01, -postR - 0.013],
        [0.024, 0.13, -postR - 0.024],
        [0.018, TABLE + 0.002, -postR - 0.04],
      ],
      0.0042,
    );
    gland(mast, 0.018, TABLE, -postR - 0.04, 0.0042);
    batch(mast);
    this.group.add(mast);
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
  private camera(size: number): THREE.Object3D {
    const ringMat = ringLight();
    this.lights.push(ringMat);
    return visionCamera(size, ringMat);
  }

  /** Ring lights flash while the camera is exposing. */
  update(inspecting: boolean, t: number): void {
    const on = inspecting && Math.floor(t * 8) % 2 === 0;
    for (const m of this.lights) m.emissiveIntensity = on ? RING_FLASH : RING_IDLE;
  }
}

/**
 * Sweeps a closed (lateral, up) section along a path of (point, lateral unit) samples, one strip
 * per section edge so the edges stay crisp; `caps` closes both ends.
 */
function sweep(path: { p: THREE.Vector3; n: THREE.Vector3 }[], section: [number, number][], caps = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const at = (k: number, [l, h]: [number, number]) => path[k].p.clone().addScaledVector(path[k].n, l).setY(path[k].p.y + h);
  for (let e = 0; e < section.length; e++) {
    const s0 = section[e];
    const s1 = section[(e + 1) % section.length];
    const base = pos.length / 3;
    for (let k = 0; k < path.length; k++) pos.push(...at(k, s0).toArray(), ...at(k, s1).toArray());
    for (let k = 1; k < path.length; k++) {
      const i = base + 2 * k;
      idx.push(i - 2, i - 1, i, i - 1, i + 1, i);
    }
  }
  if (caps) {
    const tris = THREE.ShapeUtils.triangulateShape(section.map(([l, h]) => new THREE.Vector2(l, h)), []);
    for (const k of [0, path.length - 1]) {
      const base = pos.length / 3;
      for (const pt of section) pos.push(...at(k, pt).toArray());
      for (const [a, b, c] of tris) idx.push(base + a, base + (k ? b : c), base + (k ? c : b));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A straight rod between two points. */
function rod(g: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): void {
  const mesh = cyl(r, a.distanceTo(b), m, 10);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.add(mesh);
}

/**
 * The 440 mm housing bowl (see bowl.ts for the layout and its non-overlap rules): a cylindrical
 * bowl with a stepped helical ledge climbing its wall; loose housings lying in the well; a single
 * file lying on the ledge; one housing being up-ended by a ramp wire; and the upright queue
 * between low strips and two rails each side, out through the wall along the tongue.
 */
function housingBowl(entryR: number, deckY: number, material: THREE.Material, models: Models): { frame: THREE.Group; stock: THREE.Group } {
  const frame = new THREE.Group();
  const stock = new THREE.Group();
  stock.name = 'housing-bowl-stock';
  const floor = deckY - BOWL.top;
  frame.position.set(-BOWL.exit, floor, -entryR - 0.13);
  const drive = hardware('Vibrator', 0, TABLE - floor, 0);
  drive.scale.set(2, (floor - TABLE) / 0.1385, 2);
  frame.add(drive);
  const env = measureHousing(housingPart(models));
  const layout = housingBowlLayout(env);

  // Bowl: centre cone and floor, cylindrical wall, rolled rim; the rim is open over the exit.
  const lower = [...floorProfile(), [BOWL.wall, 0.075]].map(([r, y]) => new THREE.Vector2(r, y));
  const upper = [
    [BOWL.wall, 0.075],
    [BOWL.wall, 0.088],
    [BOWL.wall + 0.002, BOWL.rim],
    [BOWL.lip, BOWL.rim],
    [BOWL.lip + 0.002, BOWL.rim - 0.004],
    [BOWL.lip + 0.002, BOWL.rim - 0.011],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  frame.add(new THREE.Mesh(new THREE.LatheGeometry(lower, 128), material));
  frame.add(new THREE.Mesh(new THREE.LatheGeometry(upper, 128, Math.PI / 2 + 0.04, 2 * Math.PI - 0.38), material));

  // Stepped helical track: a ledge with a raised bead on its inner edge, from the floor to the exit.
  const helix: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
  for (let a = BOWL.start; ; a = Math.min(0, a + 0.025)) {
    helix.push({ p: new THREE.Vector3(0, laneAt(a), 0), n: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)) });
    if (a === 0) break;
  }
  const lane = BOWL.lane;
  const ledge = sweep(helix, [
    [BOWL.wall, 0],
    [lane + 0.0015, 0],
    [lane + 0.0015, BOWL.bead],
    [lane, BOWL.bead],
    [lane, -BOWL.ledge],
    [BOWL.wall, -BOWL.ledge],
  ]);
  frame.add(new THREE.Mesh(ledge, material));

  // Discharge tongue through the wall onto the linear feeder, with a bracket to the bowl.
  block(frame, BOWL.exit, BOWL.top - 0.003, (BOWL.tongue - 0.002) / 2, 0.035, 0.006, BOWL.tongue + 0.002, material);
  block(frame, BOWL.exit + 0.008, BOWL.top - 0.022, 0.075, 0.016, 0.032, 0.01, M.frame);
  const along = (s0: number, s1: number) => {
    const out: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let s = s0; ; s = Math.min(s1, s + 0.004)) {
      const { p, n } = dischargeAt(s);
      out.push({ p: new THREE.Vector3(p.x, BOWL.top, p.y), n: new THREE.Vector3(n.x, 0, n.y) });
      if (s === s1) break;
    }
    return out;
  };
  for (const st of layout.strips) {
    const l0 = st.side * (st.offset - st.thickness / 2);
    const l1 = st.side * (st.offset + st.thickness / 2);
    frame.add(new THREE.Mesh(sweep(along(st.s0, st.s1), [[l0, 0], [l1, 0], [l1, st.height], [l0, st.height]]), M.rail));
  }
  for (const path of layout.rails.paths) frame.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, false, 'centripetal'), path.length * 2, layout.rails.r, 8), M.rail));
  const postTop = Math.max(...layout.rails.paths.map((p) => p[1].y)) + 0.003;
  for (const post of layout.rails.posts) {
    const { p, n } = dischargeAt(post.s);
    const o = post.side * layout.rails.postOffset;
    round(frame, p.x + n.x * o, (post.y0 + postTop) / 2, p.y + n.y * o, layout.rails.postR, postTop - post.y0, M.frame, 12);
    round(frame, p.x + n.x * o, postTop, p.y + n.y * o, layout.rails.postR + 0.0006, 0.002, finish.graphite, 12);
  }
  // Up-ending ramp wire, welded to the ledge at both ends.
  layout.ramp.slice(1).forEach((b, i) => rod(frame, layout.ramp[i], b, RAMP_R, M.rail));
  for (const joint of layout.ramp.slice(1, -1)) {
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(RAMP_R, 10, 8), M.rail);
    knuckle.position.copy(joint);
    frame.add(knuckle);
  }
  frame.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  batch(frame);
  const queue = new StockInstances(housingPart(models), [...layout.lying, ...layout.tipping, ...layout.upright]).group;
  queue.name = 'housing-bowl-lane';
  frame.add(queue);

  // Mirror the left-hand discharge so the bowl sits inboard of the feeder.
  frame.position.x *= -1;
  frame.scale.x = -1;
  stock.position.copy(frame.position);
  stock.add(new StockInstances(housingPart(models), layout.pile).group);
  return { frame, stock };
}

/** Vibratory bowl feeder: drive base, stepped bowl with a spiral track, and a linear track to the pick point. */
export class FeederView {
  readonly group = new THREE.Group();
  private readonly pool: THREE.Object3D[] = [];
  private readonly feederR: number;
  private readonly gates: { pin: THREE.Mesh; at: number }[] = [];
  private readonly partRadius: number;
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

    // Linear track: a stainless channel sized to the part, with side walls and, for tall parts,
    // two upper guide bars on brackets, on a linear vibratory drive; a stop at the pick end.
    const part = cfg.parts[def.part];
    const partR = def.part === 'body' ? 0.0078 : part.radius;
    this.partRadius = partR;
    const partLen = part.length;
    const cw = 2 * partR + 0.003;
    const wallH = Math.min(0.028, Math.max(0.006, partLen * 0.28));
    const rail = new THREE.Group();
    block(rail, 0, trackY - 0.004, -(r0 + r1) / 2, cw + 0.012, 0.008, r1 - r0, M.rail);
    for (const sx of [-1, 1]) {
      block(rail, sx * (cw / 2 + 0.002), trackY + wallH / 2, -(r0 + r1) / 2, 0.004, wallH, r1 - r0, M.rail);
      block(rail, sx * (cw / 2 + 0.0042), trackY + wallH - 0.003, -(r0 + r1) / 2, 0.0004, 0.0012, r1 - r0 - 0.004, finish.graphite);
    }
    if (partLen > 0.04) {
      const gy = trackY + partLen * 0.72;
      for (const sx of [-1, 1]) {
        if (def.part === 'housing') {
          block(rail, sx * (partR + 0.002), gy, -(r0 + r1) / 2, 0.003, 0.016, r1 - r0, finish.graphite);
          block(rail, sx * (partR + 0.003), trackY + 0.052, -(r0 + r1) / 2, 0.004, 0.011, r1 - r0, M.frame);
        }
        const bar = round(rail, sx * (partR + 0.0035), gy, -(r0 + r1) / 2, 0.0022, r1 - r0 - 0.01, M.rail, 12);
        bar.rotation.x = Math.PI / 2;
        for (let r = r0 + 0.03; r < r1 - 0.01; r += 0.09) {
          block(rail, sx * (cw / 2 + 0.006), (trackY + wallH + gy) / 2, -r, 0.004, gy - trackY - wallH + 0.006, 0.012, M.frame);
          block(rail, sx * (cw / 2 + 0.003), gy, -r, cw / 2 - partR + 0.004, 0.006, 0.012, M.frame);
        }
      }
    }
    // Two independently valved plungers meter one pitch at the bowl exit.
    const gateX = cw / 2 + 0.018;
    const gateY = trackY + Math.min(partLen * 0.6, 0.018);
    const gateMid = r1 - 0.018 - def.pitch / 2;
    block(rail, gateX, trackY - 0.007, -gateMid, 0.04, 0.008, def.pitch + 0.035, M.frame);
    block(rail, gateX, (gateY + trackY) / 2, -gateMid, 0.022, gateY - trackY + 0.014, def.pitch + 0.022, M.axisDark);
    for (const r of [r1 - 0.018, r1 - 0.018 - def.pitch]) {
      round(rail, gateX - 0.012, gateY, -r, 0.005, 0.006, finish.zinc, 12).rotation.z = Math.PI / 2;
      const pin = round(this.group, 0, gateY, -r, 0.0024, 0.017, M.rail, 12);
      pin.rotation.z = Math.PI / 2;
      this.gates.push({ pin, at: r - this.feederR });
      hose(
        rail,
        [
          [gateX + 0.012, gateY, -r],
          [gateX + 0.023, gateY - 0.004, -r],
          [gateX + 0.023, trackY - 0.018, -r],
          [gateX + 0.009, trackY - 0.022, -r],
        ],
        0.0018,
        finish.pipe,
      );
      block(rail, gateX, trackY - 0.018, -r, 0.02, 0.013, 0.013, finish.graphite);
    }
    // Replaceable end shoe at the product tangent, beneath the gripper.
    block(rail, 0, trackY + wallH / 2, -this.feederR + partR + 0.003, cw, wallH, 0.006, finish.graphite);
    for (const sx of [-1, 1]) block(rail, sx * (cw / 2 + 0.009), trackY + 0.008, -(r0 + 0.012), 0.008, 0.012, 0.01, M.camera);
    // Linear drive: a carrier bar flush under the track, on two inclined leaf springs over a
    // compact drive (magnet) body in the middle, its base plate and a profile stand.
    const driveY = trackY - 0.008;
    const mid = -(r0 + r1) / 2;
    const Lt = r1 - r0;
    const Ld = Math.min(0.17, 0.5 * Lt);
    block(rail, 0, driveY - 0.006, mid, 0.034, 0.012, Lt - 0.003, finish.graphite);
    for (const dr of [-1, 1]) {
      const leaf = block(rail, 0, driveY - 0.019, mid + dr * (Ld / 2 - 0.014), 0.03, 0.016, 0.0025, M.rail);
      leaf.rotation.x = 0.35;
    }
    block(rail, 0, driveY - 0.035, mid, 0.05, 0.018, Ld, M.drive);
    block(rail, 0, driveY - 0.046, mid, 0.058, 0.004, Ld + 0.016, finish.graphite);
    profile(rail, [0, TABLE + 0.006, mid], [0, driveY - 0.048, mid], 0.03);
    block(rail, 0, TABLE + 0.003, -(r0 + r1) / 2, 0.07, 0.006, 0.07, finish.graphite);
    contactPatch(rail, 0, TABLE + 0.0008, -(r0 + r1) / 2, 0.14, 0.14);
    batch(rail);
    this.group.add(rail);

    // Bowl: drive drum on the table, stainless bowl whose rim meets the track entry.
    if (def.inline) this.inline = this.buildInline(def.inline, trackY, partLen);

    const names: Record<string, string> = { body: 'Pen bodies', spring: 'Springs', springBase: 'Spring bases', housing: 'Housings' };
    this.name = names[def.part] ?? def.id;
    const l = label(this.name, 'label feeder');
    l.position.copy(local(0, trackY + 0.084, r1 + 0.10));
    this.tag = l.element;
    this.group.add(l);

    const make = (): THREE.Object3D => {
      if (def.part === 'body') return models.pen_body.clone(true);
      if (def.part === 'spring') return models.spring.clone(true);
      if (def.part === 'springBase') return models.spring_base.clone(true);
      return housingPart(models);
    };
    const n = Math.ceil(def.track / def.pitch) + 1;
    for (let i = 0; i < n; i++) {
      const o = make();
      o.position.y = trackY;
      o.visible = false;
      o.userData.product = true;
      this.pool.push(o);
      this.group.add(o);
    }
    if (def.part === 'housing') {
      const bowl = housingBowl(r1, trackY, this.bowlMat, models);
      this.bulk = bowl.stock;
      this.group.add(bowl.frame, this.bulk);
      // Swing the complete feeder about its discharge at the dial load nest.
      const angle = (-88 * Math.PI) / 180;
      this.group.rotation.y = angle;
      this.group.position.set(this.feederR * Math.sin(angle), 0, this.feederR * (Math.cos(angle) - 1));
      return;
    }
    const bowlR = 0.11;
    const bowlC = r1 + bowlR - 0.01;
    const rimY = trackY + 0.004;
    const floorY = rimY - 0.07;
    const mounting = new THREE.Group();
    const vibrator = hardware('Vibrator', 0, TABLE, -bowlC);
    vibrator.scale.y = (floorY - TABLE) / 0.1385;
    mounting.add(vibrator);
    plate(mounting, 0, TABLE + (floorY - TABLE) * 0.36, -bowlC + 0.067, 0.075, 0.022, 'VF  /  ' + def.id.slice(0, 3).toUpperCase(), 'VIBRATORY DRIVE');
    contactPatch(mounting, 0, TABLE + 0.0008, -bowlC, 0.24, 0.23);
    // Drive cable enters a compression gland and runs into the deck.
    hose(
      mounting,
      [
        [0.064, TABLE + 0.04, -bowlC],
        [0.088, TABLE + 0.03, -bowlC + 0.009],
        [0.105, TABLE + 0.008, -bowlC + 0.05],
        [0.082, TABLE + 0.004, -bowlC + 0.084],
      ],
      0.0036,
    );
    round(mounting, 0.082, TABLE + 0.002, -bowlC + 0.084, 0.009, 0.003, finish.seal);
    batch(mounting);
    const bowlProfile = [
      [0.0, 0.02],
      [0.03, 0.006],
      [0.06, 0],
      [0.085, 0],
      [0.094, 0.012],
      [0.1, 0.06],
      [bowlR, 0.07],
      [bowlR + 0.004, 0.072],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlProfile.slice(0, 6), 48), this.bowlMat);
    const openLip = new THREE.Mesh(new THREE.LatheGeometry(bowlProfile.slice(5), 64, 0.125, 2 * Math.PI - 0.25), this.bowlMat);
    openLip.castShadow = true;
    openLip.receiveShadow = true;
    bowl.add(openLip);
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
    // Ribbon track, with an upturned retaining bead and a tangent
    // discharge tongue at the end of the helix.
    const verts: number[] = [],
      indices: number[] = [];
    for (let i = 0; i < helix.length; i++) {
      const p = helix[i];
      const fraction = i / (helix.length - 1);
      const radius = 0.073 + fraction * 0.034;
      for (const r of [radius - 0.017, radius]) verts.push((p.x * r) / 0.092, p.y, (p.z * r) / 0.092);
      if (i) indices.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i, 2 * i + 1, 2 * i - 1);
      p.multiply(new THREE.Vector3((radius - 0.017) / 0.092, 1, (radius - 0.017) / 0.092));
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    ribbon.setIndex(indices);
    ribbon.computeVertexNormals();
    const track = new THREE.Mesh(ribbon, this.bowlMat);
    const bead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 100, 0.0019, 6), M.rail);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(bowlR + 0.003, 0.0022, 8, 64, 2 * Math.PI - 0.25).rotateZ(Math.PI / 2 + 0.125), M.rail);
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(local(0, rimY + 0.001, bowlC));
    track.position.copy(bowl.position);
    bead.position.copy(bowl.position);
    this.bulk.position.copy(local(0, floorY + 0.012, bowlC));
    this.group.add(mounting, bowl, rim, track, bead, this.bulk);
    block(this.group, 0, trackY + 0.0006, -r1, 0.026, 0.0012, 0.047, M.rail);
    for (const x of [-0.014, 0.014]) block(this.group, x, trackY + 0.005, -r1 - 0.012, 0.0015, 0.009, 0.03, M.rail);

    // Bulk parts lie on the bowl floor in layers, roughly along the wall: placed one by one where
    // they touch neither the bowl nor each other (deterministic, so every viewer sees the same).
    const bulkTransforms: THREE.Matrix4[] = [];
    // Include the full mesh envelope when laying loose parts in the well.
    const L = Math.max(heldLength(cfg, parts), new THREE.Box3().setFromObject(make()).getSize(new THREE.Vector3()).y);
    const pr = def.part === 'body' ? 0.0068 : part.radius;
    const placed: { y: number; a: THREE.Vector2; b: THREE.Vector2 }[] = [];
    let seed = 977 + id.length * 31;
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    // Bowl wall radius at height h above its floor, and the raised centre cone.
    const wallAt = (h: number) => (h < 0.012 ? 0.085 + h * 0.75 : 0.094 + (h - 0.012) * 0.125);
    const coneAt = (rho: number) => (rho < 0.03 ? 0.02 - rho * 0.467 : Math.max(0, 0.006 - (rho - 0.03) * 0.2));
    for (let tries = 0; tries < 900 && placed.length < 12; tries++) {
      const layer = Math.min(2, Math.floor(tries / 300));
      const y = pr + layer * 2 * pr + 0.0004;
      const ang = rnd() * Math.PI * 2;
      const rho = 0.045 + rnd() * 0.04;
      const c = new THREE.Vector2(Math.cos(ang) * rho, Math.sin(ang) * rho);
      const dir = new THREE.Vector2(-Math.sin(ang), Math.cos(ang)).rotateAround(new THREE.Vector2(), (rnd() - 0.5) * 0.9);
      const a = c.clone().addScaledVector(dir, -L / 2);
      const b = c.clone().addScaledVector(dir, L / 2);
      if (Math.max(a.length(), b.length()) > wallAt(y) - pr - 0.002) continue;
      if (coneAt(segmentToOrigin(a, b)) > y - pr + 0.0015) continue;
      if (placed.some((q) => Math.abs(q.y - y) < 2 * pr - 0.0005 && segmentDistance(a, b, q.a, q.b) < 2 * pr + 0.0008)) continue;
      placed.push({ y, a, b });
      const m = new THREE.Matrix4().makeRotationY(-Math.atan2(dir.y, dir.x) + Math.PI / 2);
      m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      m.setPosition(a.x, y - 0.012, a.y);
      bulkTransforms.push(m);
    }
    this.bulk.add(new StockInstances(make(), bulkTransforms).group);
  }

  /**
   * EM10 over the track: a camera on a post looking down at the passing parts, an air jet a
   * little further on, and the chute the jet blows bad parts into (on the far side of the track).
   */
  private buildInline(inline: NonNullable<FeederDef['inline']>, trackY: number, partLen: number): NonNullable<FeederView['inline']> {
    const camR = this.feederR + inline.at;
    const jetR = this.feederR + inline.jetAt;
    const camY = trackY + partLen + 0.006 + 0.0458;
    const top = camY + 0.03;
    const post = new THREE.Group();
    profile(post, [-0.062, TABLE, -camR], [-0.062, top, -camR], 0.025);
    const shoe = hardware('ColumnShoe', -0.062, TABLE, -camR);
    shoe.scale.setScalar(0.62);
    post.add(shoe);
    profile(post, [-0.075, top + 0.0125, -camR], [0.012, top + 0.0125, -camR], 0.025);
    block(post, 0, top - 0.002, -camR, 0.03, 0.004, 0.03, finish.graphite);
    contactPatch(post, -0.062, TABLE + 0.0008, -camR, 0.09, 0.09);
    batch(post);
    this.group.add(post);
    const ring = ringLight();
    const cam = visionCamera(0.036, ring);
    cam.position.copy(local(0, camY, camR));
    this.group.add(cam);
    // Jet nozzle on one side of the track, chute on the other.
    const nozzle = cyl(0.003, 0.02, M.rail, 12);
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.copy(local(-0.03, trackY + 0.006, jetR));
    this.group.add(nozzle, span(-0.045, -0.04, TABLE, trackY + 0.006, jetR - 0.004, jetR + 0.004, M.frame));
    const chute = new THREE.Group();
    const collector = hardware('Tote', 0.188, TABLE, -jetR - 0.089);
    collector.scale.set(0.29, 0.38, 0.32);
    chute.add(collector);
    // A dogleg gutter takes rejects around the gantry upright and drops them into the tote.
    const route = [
      new THREE.Vector3(0.018, trackY - 0.004, -jetR),
      new THREE.Vector3(0.043, trackY - 0.040, -jetR - 0.064),
      new THREE.Vector3(0.098, trackY - 0.090, -jetR - 0.089),
      new THREE.Vector3(0.184, TABLE + 0.070, -jetR - 0.089),
    ];
    for (let i = 1; i < route.length; i++) {
      const delta = route[i].clone().sub(route[i - 1]);
      const section = new THREE.Group();
      section.position.copy(route[i - 1]).addScaledVector(delta, 0.5);
      section.rotation.order = 'YXZ';
      section.rotation.y = Math.atan2(-delta.z, delta.x);
      section.rotation.z = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
      block(section, 0, 0, 0, delta.length() + 0.006, 0.002, 0.025, M.rail);
      for (const side of [-1, 1]) block(section, 0, 0.005, side * 0.012, delta.length(), 0.010, 0.002, M.frame);
      chute.add(section);
    }
    block(chute, 0.098, (route[2].y + TABLE) / 2, route[2].z, 0.009, route[2].y - TABLE, 0.009, M.frame);
    batch(chute);
    this.group.add(chute);
    const l = label(`${inline.id} rejects: 0`, 'label bin');
    l.position.copy(local(0.05, trackY + 0.03, jetR));
    this.group.add(l);
    return { at: inline.at, ring, count: l.element, id: inline.id };
  }

  update(items: number[], jam: number, t: number, bins: Record<string, number> = {}): void {
    for (const { pin, at } of this.gates) {
      const clearance = items.reduce((gap, item) => Math.min(gap, Math.abs(item - at)), Infinity);
      const open = THREE.MathUtils.clamp((this.partRadius + 0.006 - clearance) / 0.003, 0, 1);
      pin.position.x = 0.0085 + (this.partRadius + 0.003) * open;
    }
    this.pool.forEach((o, i) => {
      o.visible = i < items.length;
      if (o.visible) o.position.z = -(this.feederR + items[i]);
    });
    if (this.inline) {
      const { at, ring, count, id } = this.inline;
      ring.emissiveIntensity = items.some((x) => Math.abs(x - at) < 0.004) ? RING_FLASH : RING_IDLE;
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
  private readonly pens: StockInstances;

  constructor(cfg: LineConfig, models: Models, penBase: number) {
    const t = cfg.layout.tray;
    this.group.add(models.tray.clone(true));
    const transforms = Array.from({ length: cfg.traySize }, (_, i) => {
      const p = trayPocket(cfg, i);
      return new THREE.Matrix4().makeTranslation(p.a - t.a, penBase, -(p.r - t.r));
    });
    this.pens = new StockInstances(finishedPen(cfg, models, true), transforms);
    this.pens.count(0);
    this.group.add(this.pens.group);
  }

  fill(n: number): void {
    this.pens.count(n);
  }
}

/**
 * UN03's tray line beside EM60: the destacker holding a stack of empty trays, the tray being
 * filled under the unload robot, the conveyor (+a) carrying full trays under EM61's camera, and
 * at its end the outfeed stack of good trays and the reject rack.
 */
export class TrayView {
  readonly group = new THREE.Group();
  private readonly current: TrayLoad;
  private readonly line: TrayLoad[];
  private readonly top: TrayLoad;
  private readonly stacked: THREE.Object3D[] = [];
  private readonly ring: THREE.MeshStandardMaterial;
  private readonly outLabel: HTMLElement;
  private readonly rackLabel: HTMLElement;
  private readonly destacker: HTMLElement;
  private readonly empties: THREE.Object3D[] = [];
  private readonly trayY: number;
  private readonly trayStop: THREE.Mesh;
  private static readonly STACK = 6;

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    const t = cfg.layout.tray;
    const tl = cfg.trays;
    // The gripper lets go with the pen's base just above the tray floor.
    const fullPen = heldLength(cfg, ['body', 'spring', 'springBase', 'cartridge', 'housing']);
    const penBase = cfg.layout.z.tray - fullPen;
    this.trayY = penBase - 0.006;
    const y = this.trayY;
    const half = (t.rows * t.pitch) / 2 + 0.02;
    const a0 = tl.destack - 0.07;
    const a1 = tl.end + 0.07;
    // Conveyor: a low twin-strand belt conveyor standing on the table, guided either side.
    this.group.add(
      miniConveyor({
        a0,
        a1,
        r: t.r,
        y,
        width: 2 * half - 0.012,
        frame: y - TABLE - 0.003,
        strands: 0.03,
        guide: { gap: 2 * half - 0.004, height: 0.014 },
        drive: { end: 1, side: 1, scale: 0.62 },
      }),
    );
    const trackFrame = new THREE.Group();
    for (const a of [a0 + 0.02, a1 - 0.02])
      for (const r of [t.r - half - 0.004, t.r + half + 0.004]) {
        block(trackFrame, a, TABLE + 0.003, -r, 0.04, 0.006, 0.03, finish.graphite);
        contactPatch(trackFrame, a, TABLE + 0.0009, -r, 0.08, 0.07);
      }
    // Side datum shoes and opposed adjustable guides at the packing position.
    const trayEdge = (t.rows * t.pitch + 0.027) / 2;
    for (const sign of [-1, 1]) {
      for (const da of [-0.036, 0.036]) {
        const x = t.a + da;
        block(trackFrame, x, y - 0.004, -t.r + sign * (trayEdge + 0.014), 0.023, 0.008, 0.039, M.frame);
        block(trackFrame, x, y + 0.012, -t.r + sign * (trayEdge + 0.021), 0.018, 0.034, 0.009, finish.graphite);
        round(trackFrame, x, y + 0.014, -t.r + sign * (trayEdge + 0.016), 0.003, 0.034, M.rail, 12).rotation.x = Math.PI / 2;
        round(trackFrame, x, y + 0.014, -t.r + sign * (trayEdge + 0.034), 0.006, 0.006, finish.graphite, 12).rotation.x = Math.PI / 2;
      }
      block(trackFrame, t.a, y + 0.014, -t.r + sign * (trayEdge + 0.003), 0.098, 0.012, 0.006, finish.seal);
    }
    // Pneumatic datum pin rises between the strands against the leading skirt.
    const stopX = t.a + (t.cols * t.pitch + 0.02) / 2 + 0.003;
    round(trackFrame, stopX, y - 0.009, -t.r, 0.011, 0.023, finish.graphite);
    this.trayStop = round(this.group, stopX, y, -t.r, 0.0035, 0.032, M.rail);
    // Through-beam tray detector and M8 lead on the inspection stop.
    block(trackFrame, tl.check.a, y + 0.024, -t.r - half - 0.014, 0.023, 0.041, 0.017, M.camera);
    round(trackFrame, tl.check.a, y + 0.03, -t.r - half - 0.004, 0.004, 0.004, M.lens).rotation.x = Math.PI / 2;
    hose(
      trackFrame,
      [
        [tl.check.a, y + 0.007, -t.r - half - 0.018],
        [tl.check.a + 0.008, y - 0.016, -t.r - half - 0.038],
        [tl.check.a + 0.067, TABLE + 0.002, -t.r - half - 0.051],
      ],
      0.0026,
    );
    gland(trackFrame, tl.check.a + 0.067, TABLE, -t.r - half - 0.051, 0.0026);
    plate(trackFrame, tl.check.a - 0.106, y - 0.021, -t.r + half + 0.005, 0.105, 0.025, 'EM61', 'TRAY INSPECTION');
    batch(trackFrame);
    this.group.add(trackFrame);
    const make = () => {
      const l = new TrayLoad(cfg, models, penBase - y);
      this.group.add(l.group);
      return l;
    };
    this.current = make();
    this.line = [make(), make(), make()];

    // Destacker: four angle guides round a stack of empty trays above the conveyor, upstream of
    // the packing position, on a frame with the separating cylinders that let one tray down.
    const w = (t.cols * t.pitch) / 2 + 0.015;
    const destacker = new THREE.Group();
    const topY = y + 0.042 + 0.012 * TrayView.STACK;
    for (const da of [-w, w])
      for (const dr of [-half, half]) {
        const ax = tl.destack + da;
        block(destacker, ax, (y + 0.016 + topY) / 2, -(t.r + dr), 0.012, topY - y - 0.016, 0.002, M.rail);
        block(destacker, ax + Math.sign(da) * 0.005, (y + 0.016 + topY) / 2, -(t.r + dr - Math.sign(dr) * 0.005), 0.002, topY - y - 0.016, 0.012, M.rail);
        block(destacker, ax, topY + 0.004, -(t.r + dr), 0.014, 0.008, 0.014, finish.graphite);
      }
    for (const dr of [-half - 0.008, half + 0.008]) {
      block(destacker, tl.destack, y + 0.022, -(t.r + dr), 2 * w + 0.03, 0.012, 0.008, M.frame);
      for (const da of [-w * 0.5, w * 0.5]) {
        block(destacker, tl.destack + da, y + 0.034, -(t.r + dr + Math.sign(dr) * 0.01), 0.018, 0.016, 0.024, M.axisDark);
        round(destacker, tl.destack + da, y + 0.044, -(t.r + dr + Math.sign(dr) * 0.014), 0.0024, 0.004, finish.pipe, 12);
      }
      for (const da of [-w - 0.012, w + 0.012]) profile(destacker, [tl.destack + da, TABLE, -(t.r + dr)], [tl.destack + da, y + 0.016, -(t.r + dr)], 0.02);
    }
    // Separator blades support the lowest flange while the released tray
    // passes beneath. Their outer ends enter the destacker cross rails.
    for (const sign of [-1, 1]) {
      for (const da of [-w * 0.5, w * 0.5]) {
        block(destacker, tl.destack + da, y + 0.057, -t.r + sign * (half - 0.002), 0.017, 0.006, 0.036, M.rail);
        block(destacker, tl.destack + da, y + 0.045, -t.r + sign * (half + 0.014), 0.018, 0.027, 0.01, finish.graphite);
      }
    }
    batch(destacker);
    this.group.add(destacker);
    for (let k = 0; k < TrayView.STACK; k++) {
      const empty = models.tray.clone(true);
      empty.position.copy(local(tl.destack, y + 0.03 + k * 0.012, t.r));
      this.empties.push(empty);
      this.group.add(empty);
    }
    const ds = label('Destacker', 'label feeder');
    ds.position.copy(local(tl.destack, y + 0.16, t.r));
    this.destacker = ds.element;
    this.group.add(ds);

    // EM61: camera on a profile post outside the conveyor, looking down at the tray it stops.
    const check = tl.check;
    const mast = new THREE.Group();
    const postR = t.r + half + 0.045;
    profile(mast, [check.a, TABLE, -postR], [check.a, y + 0.3, -postR], 0.03);
    mast.add(hardware('ColumnShoe', check.a, TABLE, -postR));
    profile(mast, [check.a, y + 0.285, -(postR + 0.015)], [check.a, y + 0.285, -(t.r - 0.03)], 0.03);
    block(mast, check.a, y + 0.266, -t.r, 0.05, 0.008, 0.05, finish.graphite);
    hose(
      mast,
      [
        [check.a + 0.012, y + 0.27, -t.r - 0.012],
        [check.a + 0.03, y + 0.31, -t.r - 0.06],
        [check.a + 0.024, y + 0.3, -postR],
        [check.a + 0.02, y + 0.1, -postR - 0.018],
        [check.a + 0.04, TABLE + 0.002, -postR - 0.04],
      ],
      0.0035,
    );
    gland(mast, check.a + 0.04, TABLE, -postR - 0.04, 0.0035);
    contactPatch(mast, check.a, TABLE + 0.0009, -postR, 0.12, 0.12);
    batch(mast);
    this.group.add(mast);
    this.ring = ringLight();
    const head = visionCamera(0.05, this.ring);
    head.position.copy(local(check.a, y + 0.233, t.r));
    this.group.add(head);
    const name = label(`${check.id} ${check.name}`, 'label feeder');
    name.position.copy(local(check.a, y + 0.33, t.r + half + 0.04));
    this.group.add(name);

    // Outfeed stack (good trays) past the end, reject rack beside the end.
    for (let k = 0; k < TrayView.STACK; k++) {
      const tr = models.tray.clone(true);
      tr.position.copy(local(tl.end + 0.12, TABLE + k * 0.012, t.r));
      tr.visible = false;
      this.stacked.push(tr);
      this.group.add(tr);
    }
    this.top = make();
    // Spare empty trays for the destacker, stacked on the next bench along. Nested trays show
    // only their skirt band and lip, so all but the top one of each stack are drawn as just that.
    const spares: THREE.Matrix4[] = [];
    const nested = new THREE.Group();
    const tw = t.cols * t.pitch + 0.02;
    const td = t.rows * t.pitch + 0.02;
    const trayFinish = trayMaterial(models.tray);
    for (const a of [tl.end + 0.36, tl.end + 0.58]) {
      spares.push(new THREE.Matrix4().makeTranslation(a, TABLE + 8 * 0.012, -(t.r + 0.03)));
      // The bottom tray shows its whole skirt, down to the deck; each one above, its top 12 mm.
      block(nested, a, TABLE + 0.015, -(t.r + 0.03), tw * 0.975, 0.03, td * 0.985, trayFinish);
      for (let k = 0; k < 8; k++) {
        block(nested, a, TABLE + k * 0.012 + 0.024, -(t.r + 0.03), tw * 0.985, 0.012, td * 0.99, trayFinish);
        block(nested, a, TABLE + k * 0.012 + 0.0293, -(t.r + 0.03), tw + 0.007, 0.0014, td + 0.007, trayFinish);
      }
    }
    batch(nested);
    this.group.add(nested);
    const spare = new StockInstances(models.tray.clone(true), spares);
    spare.group.userData.product = false;
    this.group.add(spare.group);
    for (const a of [tl.end + 0.36, tl.end + 0.58]) {
      const patch = new THREE.Group();
      // Reaching a few centimetres past the stack, so the darkening shows round its foot.
      contactPatch(patch, a, TABLE + 0.0009, -(t.r + 0.03), tw + 0.08, td + 0.09);
      this.group.add(patch);
    }
    const out = label('Trays out: 0', 'label feeder');
    out.position.copy(local(tl.end + 0.12, y + 0.2, t.r));
    this.outLabel = out.element;
    this.group.add(out);
    const rackR = t.r + half + 0.12;
    const rackBin = hardware('Tote', tl.end, TABLE, -rackR);
    rackBin.scale.set(0.63, 0.46, 0.74);
    this.group.add(rackBin);
    plate(this.group, tl.end, TABLE + 0.041, -rackR + 0.074, 0.072, 0.021, 'TRAY HOLD', 'EM61', '#a5493e');
    const rack = label(`${check.id} rejects: 0`, 'label bin');
    rack.position.copy(local(tl.end, y + 0.12, rackR));
    this.rackLabel = rack.element;
    this.group.add(rack);
  }

  private place(load: TrayLoad, a: number, dy = 0): void {
    load.group.position.copy(local(a, this.trayY + dy, this.cfg.layout.tray.r));
  }

  update(tray: Frame['tray'], t: number, refill = 0): void {
    // The destacker's stack goes down as trays are used; empty, it waits for the operator.
    this.empties.forEach((e, i) => (e.visible = i < Math.min(tray.stack, TrayView.STACK)));
    this.destacker.classList.toggle('jam', refill > 0);
    this.destacker.textContent = refill > 0 ? `Destacker empty: refilling (${Math.ceil(refill)} s)` : `Destacker: ${tray.stack} trays`;
    const pack = this.cfg.layout.tray.a;
    const tl = this.cfg.trays;
    // During a change the destacker slides the next empty tray from under its stack into place.
    const k = tray.changing > 0 ? 1 - tray.changing / this.cfg.trayChange : 1;
    this.place(this.current, tl.destack + (pack - tl.destack) * k);
    this.current.fill(tray.count);
    const passing = tray.line.some(([a]) => a > pack && a < pack + 0.115);
    this.trayStop.position.y = this.trayY + (passing || tray.changing > 0 ? -0.018 : 0);
    this.line.forEach((load, i) => {
      const tr = tray.line[i];
      load.group.visible = !!tr;
      if (!tr) return;
      this.place(load, tr[0]);
      load.fill(tr[1]);
    });
    this.ring.emissiveIntensity = tray.line.some((x) => x[2] === 1) && Math.floor(t * 8) % 2 === 0 ? RING_FLASH : RING_IDLE;
    // The stack shows up to a handful of trays, the top one full.
    const n = Math.min(tray.stacked, TrayView.STACK);
    this.stacked.forEach((s, i) => (s.visible = i < n - 1));
    this.top.group.visible = n > 0;
    this.top.group.position.copy(local(tl.end + 0.12, TABLE + Math.max(0, n - 1) * 0.012, this.cfg.layout.tray.r));
    this.top.fill(this.cfg.traySize);
    this.outLabel.textContent = `Trays out: ${tray.stacked}`;
    this.rackLabel.textContent = `${tl.check.id} rejects: ${tray.rejected}`;
  }
}

/**
 * Code printed on the labels of finished pens in trays and bins. Those don't track which pen is
 * which, so they all show this sample; pens on movers and in grippers show their own.
 */
const SAMPLE_CODE = '(01)05712345000014(17)291114(10)B261114(21)A7K2P9X4Q1RZ';

/** A finished, labelled pen, origin at the body's base. */
export function finishedPen(cfg: LineConfig, models: Models, stock = false): THREE.Object3D {
  const a = new AssemblyView(cfg, models);
  // Stock copies leave out the spring and its base: the housing hides them.
  a.show(stock ? ['body', 'cartridge', 'housing'] : ['body', 'spring', 'springBase', 'cartridge', 'housing']);
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
    const tote = new THREE.Group();
    tote.add(hardware('Tote'));
    // White label cards in the moulded label fields of both long sides.
    plate(tote, 0, 0.085, 0.0957, 0.113, 0.037, 'REJECT', name + '   /   HOLD', '#b3261e');
    plate(tote, 0, 0.085, -0.0957, 0.113, 0.037, 'REJECT', name + '   /   HOLD', '#b3261e', Math.PI);
    contactPatch(tote, 0, 0.001, 0, w * 1.28, d * 1.28);
    batch(tote);
    this.group.add(tote);
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

/** Shortest distance between plan segments ab and cd. */
function segmentDistance(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, d: THREE.Vector2): number {
  const cross = (p: THREE.Vector2, q: THREE.Vector2, r: THREE.Vector2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.sign(cross(a, b, c)) !== Math.sign(cross(a, b, d)) && Math.sign(cross(c, d, a)) !== Math.sign(cross(c, d, b))) return 0;
  const toSeg = (p: THREE.Vector2, s0: THREE.Vector2, s1: THREE.Vector2) => {
    const v = s1.clone().sub(s0);
    const t = THREE.MathUtils.clamp(p.clone().sub(s0).dot(v) / v.lengthSq(), 0, 1);
    return p.distanceTo(s0.clone().addScaledVector(v, t));
  };
  return Math.min(toSeg(a, c, d), toSeg(b, c, d), toSeg(c, a, b), toSeg(d, a, b));
}

/** Distance from the plan origin to segment ab. */
function segmentToOrigin(a: THREE.Vector2, b: THREE.Vector2): number {
  const v = b.clone().sub(a);
  const t = THREE.MathUtils.clamp(-a.dot(v) / v.lengthSq(), 0, 1);
  return a.clone().addScaledVector(v, t).length();
}

/** The tray model's moulding finish (for simplified stacks of the same trays). */
function trayMaterial(tray: THREE.Object3D): THREE.Material {
  let m: THREE.Material | null = null;
  tray.traverse((o) => {
    if (!m && o instanceof THREE.Mesh && !Array.isArray(o.material)) m = o.material;
  });
  return m ?? M.nest;
}
