// Views of station equipment, each drawn in its station's local coordinates from frame data.
import * as THREE from 'three';
import type { FeederDef, LineConfig, PartType } from '../sim/config';
import { gripRadius, heldLength, trayPocket } from '../sim/layout';
import type { Frame, RobotFrame } from '../sim/protocol';
import { M, RAIL_Y, type Reach, TABLE, cyl, label, local, mat, span } from './build';
import type { Models } from './models';
import { StockInstances, batch, block, finish, hardware, hose, plate, profile, round, visionCamera } from './hardware';
import { contactPatch } from './hall';
import { miniConveyor } from './conveyor';
import { AssemblyView, HeldView, housingPart } from './movers';

/** A ring light's diffuser: dim when idle, flashed bright while its camera exposes. */
export function ringLight(): THREE.MeshStandardMaterial {
  return mat(0xf4f8fa, { emissive: 0xcfeaff, emissiveIntensity: 0.2, roughness: 0.3 });
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
  private readonly rod: THREE.Mesh;
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
    batch(axis);
    this.arm.add(axis);
    this.carrier = new CableCarrier(top + 0.079, rMin, beamR);
    this.arm.add(this.carrier.links);
    const slide = new THREE.Group();
    this.glandY = cfg.layout.z.safe + 0.069;
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
        [0.027, this.glandY + 0.027, 0],
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
        [0.029, this.glandY + stroke * 0.83, 0],
        [0.038, this.glandY + stroke * 0.84, 0.015],
        [0.039, top + 0.102, 0.023],
        [-0.064, top + 0.117, 0.01],
      ],
      0.0028,
    );
    batch(slide);
    this.carriage.add(slide);
    this.rod = cyl(0.008, 1, M.rail, 24);
    this.carriage.add(this.rod);
    const tool = hardware('JawBody');
    this.column.add(tool);
    for (let i = 0; i < 2; i++) {
      // Jaw fingers hang 4 mm below the tip; the second one is turned to face the first.
      const f = hardware('Finger', 0, 0.02, 0);
      if (i) f.rotation.y = Math.PI;
      this.fingers.push(f);
      this.column.add(f);
    }
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
    const tip = r.z + 0.048;
    this.rod.scale.y = Math.max(0.001, this.glandY - tip);
    this.rod.position.y = (this.glandY + tip) / 2;
    this.carrier.travel(-r.r);
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
  constructor(reach: Reach, beamR: number, lowestTip: number, cfg: LineConfig, models: Models, arms: number, withLaser: boolean, press = false) {
    const { aMin, aMax, rMin } = reach;
    const top = RAIL_Y + 0.02;
    const frame = new THREE.Group();
    profile(frame, [aMin - 0.035, top - 0.026, -beamR], [aMax + 0.035, top - 0.026, -beamR], 0.05);
    block(frame, (aMin + aMax) / 2, top - 0.007, -beamR + 0.026, aMax - aMin + 0.065, 0.014, 0.012, M.rail);
    for (let a = aMin; a <= aMax + 0.001; a += 0.052) {
      round(frame, a, top - 0.008, -beamR + 0.033, 0.0027, 0.002, finish.seal, 8).rotation.x = Math.PI / 2;
    }
    if (press) {
      const standard = hardware('PressStandard', (aMin + aMax) / 2, TABLE, -beamR - 0.026);
      standard.scale.y = (top - 0.052 - TABLE) / 0.486;
      frame.add(standard);
      hose(
        frame,
        [
          [0.017, TABLE + 0.015, -beamR - 0.077],
          [0.047, 0.03, -beamR - 0.099],
          [0.051, 0.43, -beamR - 0.098],
          [0.045, top - 0.08, -beamR - 0.075],
          [0.039, top - 0.032, -beamR - 0.045],
        ],
        0.004,
        finish.pipe,
      );
      // The air line ends in a flow-control block on the beam's back face.
      block(frame, 0.039, top - 0.03, -beamR - 0.031, 0.028, 0.03, 0.012, M.axisDark);
      round(frame, 0.039, top - 0.012, -beamR - 0.031, 0.004, 0.008, finish.zinc, 12);
    } else {
      for (const a of [aMin - 0.008, aMax + 0.008]) {
        profile(frame, [a, TABLE, -beamR], [a, top - 0.05, -beamR]);
        frame.add(hardware('ColumnShoe', a, TABLE, -beamR));
        contactPatch(frame, a, TABLE + 0.0009, -beamR, 0.12, 0.12);
      }
      round(frame, aMax + 0.074, TABLE + 0.002, -beamR - 0.07, 0.009, 0.004, finish.seal);
      hose(
        frame,
        [
          [aMax + 0.032, top - 0.012, -beamR],
          [aMax + 0.053, top - 0.078, -beamR - 0.024],
          [aMax + 0.03, 0.32, -beamR - 0.03],
          [aMax + 0.024, 0.014, -beamR - 0.032],
          [aMax + 0.074, TABLE + 0.004, -beamR - 0.07],
        ],
        0.005,
      );
    }
    for (const a of [aMin - 0.038, aMax + 0.038]) block(frame, a, top - 0.025, -beamR, 0.008, 0.056, 0.056, M.axisDark);
    const motor = hardware('Servo', aMax + 0.04, top - 0.025, -beamR);
    frame.add(motor);
    batch(frame);
    this.group.add(frame);
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

    // Linear track: a stainless channel sized to the part, with side walls and, for tall parts,
    // two upper guide bars on brackets, on a linear vibratory drive; a stop at the pick end.
    const part = cfg.parts[def.part];
    const partR = def.part === 'body' ? 0.0078 : part.radius;
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
        const bar = round(rail, sx * (partR + 0.0035), gy, -(r0 + r1) / 2, 0.0022, r1 - r0 - 0.01, M.rail, 12);
        bar.rotation.x = Math.PI / 2;
        for (let r = r0 + 0.03; r < r1 - 0.01; r += 0.09) {
          block(rail, sx * (cw / 2 + 0.006), (trackY + wallH + gy) / 2, -r, 0.004, gy - trackY - wallH + 0.006, 0.012, M.frame);
          block(rail, sx * (cw / 2 + 0.003), gy, -r, cw / 2 - partR + 0.004, 0.006, 0.012, M.frame);
        }
      }
    }
    // Pick-end stop with a through-beam part sensor.
    block(rail, 0, trackY + 0.012, -(r0 - 0.004), cw + 0.012, 0.024, 0.008, M.frame);
    for (const sx of [-1, 1]) block(rail, sx * (cw / 2 + 0.009), trackY + 0.008, -(r0 + 0.012), 0.008, 0.012, 0.01, M.camera);
    // Linear drive: magnet body, leaf springs, base plate and a profile stand.
    const driveY = trackY - 0.008;
    block(rail, 0, driveY - 0.006, -(r0 + r1) / 2, 0.034, 0.012, r1 - r0 - 0.04, finish.graphite);
    for (const r of [r0 + 0.035, r1 - 0.035]) {
      const leaf = block(rail, 0, driveY - 0.022, -r, 0.03, 0.022, 0.0025, M.rail);
      leaf.rotation.x = 0.35;
    }
    block(rail, 0, driveY - 0.03, -(r0 + r1) / 2, 0.05, 0.014, r1 - r0 - 0.02, M.drive);
    block(rail, 0, driveY - 0.039, -(r0 + r1) / 2, 0.058, 0.004, r1 - r0 - 0.012, finish.graphite);
    profile(rail, [0, TABLE + 0.006, -(r0 + r1) / 2], [0, driveY - 0.041, -(r0 + r1) / 2], 0.03);
    block(rail, 0, TABLE + 0.003, -(r0 + r1) / 2, 0.07, 0.006, 0.07, finish.graphite);
    contactPatch(rail, 0, TABLE + 0.0008, -(r0 + r1) / 2, 0.14, 0.14);
    batch(rail);
    this.group.add(rail);

    // Bowl: drive drum on the table, stainless bowl whose rim meets the track entry.
    const bowlR = 0.11;
    const bowlC = r1 + bowlR - 0.01;
    const rimY = trackY + 0.004;
    const floorY = rimY - 0.07;
    const mounting = new THREE.Group();
    const vibrator = hardware('Vibrator', 0, TABLE, -bowlC);
    vibrator.scale.y = (floorY - TABLE) / 0.1385;
    mounting.add(vibrator);
    plate(
      mounting,
      0,
      TABLE + (floorY - TABLE) * 0.36,
      -bowlC + 0.067,
      0.075,
      0.022,
      'VF  /  ' + def.id.slice(0, 3).toUpperCase(),
      'VIBRATORY DRIVE',
    );
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

    if (def.inline) this.inline = this.buildInline(def.inline, trackY, partLen);

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
    // Bulk parts lie on the bowl floor in layers, roughly along the wall: placed one by one where
    // they touch neither the bowl nor each other (deterministic, so every viewer sees the same).
    const bulkTransforms: THREE.Matrix4[] = [];
    const L = heldLength(cfg, parts);
    const pr = def.part === 'body' ? 0.0068 : part.radius;
    const placed: { y: number; a: THREE.Vector2; b: THREE.Vector2 }[] = [];
    let seed = 977 + id.length * 31;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
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
    const collector = hardware('Tote', 0.061, TABLE, -jetR);
    collector.scale.set(0.29, 0.38, 0.32);
    chute.add(collector);
    const ramp = block(chute, 0.042, trackY - 0.021, -jetR, 0.051, 0.002, 0.037, M.rail);
    ramp.rotation.z = -0.58;
    block(chute, 0.049, (TABLE + trackY - 0.023) / 2, -jetR + 0.024, 0.009, trackY - 0.023 - TABLE, 0.009, M.frame);
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
    // Through-beam tray detector and M8 lead on the inspection stop.
    block(trackFrame, tl.check.a, y + 0.024, -t.r - half - 0.014, 0.023, 0.041, 0.017, M.camera);
    round(trackFrame, tl.check.a, y + 0.03, -t.r - half - 0.004, 0.004, 0.004, M.lens).rotation.x = Math.PI / 2;
    hose(
      trackFrame,
      [
        [tl.check.a, y + 0.007, -t.r - half - 0.018],
        [tl.check.a + 0.008, y - 0.016, -t.r - half - 0.038],
        [tl.check.a + 0.067, TABLE + 0.006, -t.r - half - 0.051],
      ],
      0.0026,
    );
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
        [check.a + 0.04, TABLE + 0.004, -postR - 0.04],
      ],
      0.0035,
    );
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
    // Spare empty trays for the destacker, stacked on the next bench along.
    const spares: THREE.Matrix4[] = [];
    for (const a of [tl.end + 0.36, tl.end + 0.58])
      for (let k = 0; k < 9; k++) spares.push(new THREE.Matrix4().makeTranslation(a, TABLE + k * 0.012, -(t.r + 0.03)));
    const spare = new StockInstances(models.tray.clone(true), spares);
    spare.group.userData.product = false;
    this.group.add(spare.group);
    for (const a of [tl.end + 0.36, tl.end + 0.58]) {
      const patch = new THREE.Group();
      contactPatch(patch, a, TABLE + 0.0009, -(t.r + 0.03), 0.16, 0.26);
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
    this.line.forEach((load, i) => {
      const tr = tray.line[i];
      load.group.visible = !!tr;
      if (!tr) return;
      this.place(load, tr[0]);
      load.fill(tr[1]);
    });
    this.ring.emissiveIntensity = tray.line.some((x) => x[2] === 1) && Math.floor(t * 8) % 2 === 0 ? 2.5 : 0.2;
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
