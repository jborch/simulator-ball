// Views of station equipment, each drawn in its station's local coordinates from frame data.
import * as THREE from 'three';
import type { FeederDef, LineConfig, PartType } from '../sim/config';
import { gripRadius, heldLength, trayPocket } from '../sim/layout';
import type { Frame, RobotFrame } from '../sim/protocol';
import { M, RAIL_Y, type Reach, TABLE, box, cyl, label, local, mat, span } from './build';
import type { Models } from './models';
import { StockInstances, batch, block, finish, hardware, hose, plate, profile, round } from './hardware';
import { contactPatch } from './hall';
import { AssemblyView, HeldView, housingPart } from './movers';

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
  private readonly fingers: THREE.Mesh[] = [];

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
    block(axis, -0.041, top + 0.005, -beamR, 0.109, 0.034, 0.072, M.axisDark);
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
      const f = span(-0.004, 0.004, -0.004, 0.022, -0.0025, 0.0025, M.frame);
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
          [0.039, top - 0.017, -beamR - 0.046],
        ],
        0.004,
        finish.pipe,
      );
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
    for (const offset of [-0.45, -0.56, -0.72]) round(g, 0, size * offset, 0, size * 0.245, size * 0.085, finish.graphite);
    for (let i = 0; i < 5; i++) block(g, 0, size * (i * 0.12 - 0.21), 0, size * 0.74, 0.0025, size * 0.74, M.axisDark);
    round(g, 0, -size * 0.83, 0, size * 0.43, 0.004, finish.graphite);
    round(g, 0, -size * 0.87, 0, size * 0.19, 0.002, M.lens);
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
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile.slice(0, 6), 48), this.bowlMat);
    const openLip = new THREE.Mesh(new THREE.LatheGeometry(profile.slice(5), 64, 0.125, 2 * Math.PI - 0.25), this.bowlMat);
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
    const bulkTransforms: THREE.Matrix4[] = [];
    for (let i = 0; i < 12; i++) {
      const r = (k: number) => (((Math.sin((i + 3) * 37.77 + k * 11.3) * 9631.17) % 1) + 1) % 1;
      const holder = new THREE.Object3D();
      const ang = r(1) * Math.PI * 2;
      const rad = 0.02 + r(2) * 0.025;
      holder.position.set(Math.cos(ang) * rad, (i % 3) * 0.009, Math.sin(ang) * rad);
      holder.rotation.y = -ang;
      holder.updateMatrix();
      const laying = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      laying.setPosition(0, 0, -heldLength(cfg, parts) / 2);
      bulkTransforms.push(holder.matrix.multiply(laying));
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
    this.pens = new StockInstances(finishedPen(cfg, models), transforms);
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
    // Conveyor: frame on the table with a dark belt on top, side guides at tray height.
    this.group.add(span(a0, a1, TABLE, y - 0.004, t.r - half, t.r + half, M.frame));
    this.group.add(span(a0, a1, y - 0.004, y, t.r - half + 0.005, t.r + half - 0.005, M.drive));
    for (const r of [t.r - half - 0.003, t.r + half + 0.003]) this.group.add(span(a0, a1, y - 0.004, y + 0.012, r - 0.003, r + 0.003, M.rail));
    const trackFrame = new THREE.Group();
    for (const r of [t.r - half, t.r + half]) {
      block(trackFrame, (a0 + a1) / 2, y - 0.025, -r, a1 - a0, 0.006, 0.003, finish.graphite);
      for (const a of [a0 + 0.016, a0 + 0.23, a1 - 0.016]) {
        round(trackFrame, a, y - 0.019, -r + Math.sign(t.r - r) * 0.007, 0.004, 0.013, M.rail, 12).rotation.x = Math.PI / 2;
      }
    }
    for (const a of [a0 + 0.009, a1 - 0.009]) {
      round(trackFrame, a, y - 0.018, -t.r, 0.017, 2 * half + 0.01, M.rail, 24).rotation.x = Math.PI / 2;
    }
    const drive = hardware('Servo', a1 - 0.022, y - 0.025, -t.r - half - 0.006);
    drive.scale.setScalar(0.68);
    drive.rotation.y = Math.PI / 2;
    trackFrame.add(drive);
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

    // Destacker: four posts holding a stack of empty trays above the conveyor upstream of the packing position.
    const w = (t.cols * t.pitch) / 2 + 0.015;
    for (const da of [-w, w]) for (const dr of [-half, half]) this.group.add(span(tl.destack + da - 0.004, tl.destack + da + 0.004, y, y + 0.03 + 0.012 * TrayView.STACK, t.r + dr - 0.004, t.r + dr + 0.004, M.frame));
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

    // EM61: camera on a post outside the conveyor, looking down at the tray it stops.
    const check = tl.check;
    this.group.add(span(check.a - 0.01, check.a + 0.01, TABLE, y + 0.26, t.r + half + 0.03, t.r + half + 0.05, M.frame));
    this.group.add(span(check.a - 0.01, check.a + 0.01, y + 0.25, y + 0.27, t.r - 0.01, t.r + half + 0.05, M.frame));
    this.group.add(span(check.a - 0.025, check.a + 0.025, y + 0.19, y + 0.25, t.r - 0.025, t.r + 0.025, M.camera));
    this.ring = mat(0xffffff, { emissive: 0xbfe3ff, emissiveIntensity: 0.2 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 28), this.ring);
    torus.rotation.x = Math.PI / 2;
    torus.position.copy(local(check.a, y + 0.185, t.r));
    this.group.add(torus);
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
