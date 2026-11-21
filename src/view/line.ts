import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import type { Frame } from '../sim/protocol';
import { pose, trackLength } from '../sim/track';
import { BELT_Y, BELT_W, M, RIB, mat, side, v3 } from './build';

/** Radius of the belt's guide rails, which also sit this high (centre) above the belt. */
const RAIL_R = 0.005;
/** Inner edge of each belt strand (offset from the belt centre line). */
const STRAND_IN = 0.021;
import type { Sample } from './interp';
import type { Models } from './models';
import { MoverView } from './movers';
import { StationView } from './station';
import { CartridgeCellView, HousingDialView, SpringBaseLineView } from './sublines';
import { buildBases } from './bases';
import { batch, block, finish, hardware, profile, round } from './hardware';
import { beltTexture } from './textures';

export class LineView {
  readonly group = new THREE.Group();
  readonly movers: MoverView[];
  private readonly stations: StationView[];
  private readonly springBases: SpringBaseLineView;
  private readonly dial: HousingDialView;
  private readonly cartridges: CartridgeCellView;
  private readonly beltTex: THREE.Texture;
  private beltTravel = 0;
  /** Splice of the belt strands, carried round with the belt. */
  private readonly seam = new THREE.Group();
  private readonly L: number;

  constructor(
    private readonly cfg: LineConfig,
    models: Models,
  ) {
    this.L = trackLength(cfg.track);
    this.group.add(buildBases(cfg));
    this.beltTex = beltTexture();
    this.buildBelt();
    this.stations = cfg.stations.map((d) => {
      const sv = new StationView(d, cfg, models);
      this.group.add(sv.group);
      return sv;
    });
    this.springBases = new SpringBaseLineView(cfg, models);
    this.group.add(this.springBases.group);
    this.dial = new HousingDialView(cfg, models);
    this.group.add(this.dial.group);
    this.cartridges = new CartridgeCellView(cfg, models);
    this.group.add(this.cartridges.group);
    this.movers = Array.from({ length: cfg.mover.count }, (_, i) => {
      const mv = new MoverView(i + 1, cfg, models);
      this.group.add(mv.root, mv.shadow);
      return mv;
    });
  }

  /** A flat strip swept along the loop between offsets r0..r1 (across the belt) at height h. */
  private strip(r0: number, r1: number, h: number, n: number): THREE.BufferGeometry {
    const t = this.cfg.track;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * this.L;
      const p = pose(t, s);
      const a = side(p, r1);
      const b = side(p, r0);
      pos.push(a.x, h, -a.y, b.x, h, -b.y);
      uv.push(0, s / RIB, 1, s / RIB);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildBelt(): void {
    const t = this.cfg.track;
    const n = 720;
    const railIn: THREE.Vector3[] = [];
    const railOut: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const p = pose(t, (i / n) * this.L);
      const o = side(p, BELT_W / 2 + 0.012);
      const inn = side(p, -BELT_W / 2 - 0.012);
      // Low guide rails (crown 10 mm above the belt), so a camera at mover height sees the
      // number plates on the movers' sides over them.
      railOut.push(v3(o.x, o.y, BELT_Y + RAIL_R));
      railIn.push(v3(inn.x, inn.y, BELT_Y + RAIL_R));
    }
    // Twin belt strands under the carriers' edges; the stoppers rise in the channel between them.
    const beltMat = new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide });
    for (const [r0, r1] of [
      [STRAND_IN, BELT_W / 2],
      [-BELT_W / 2, -STRAND_IN],
    ]) {
      const belt = new THREE.Mesh(this.strip(r0, r1, BELT_Y - 0.002, n), beltMat);
      belt.receiveShadow = true;
      this.group.add(belt);
    }
    // Finger splice across each strand: a fine zig-zag joint line, barely lighter than the belt.
    const splice = new THREE.MeshStandardMaterial({ color: 0x34383a, roughness: 0.55 });
    for (const [r0, r1] of [
      [STRAND_IN, BELT_W / 2],
      [-BELT_W / 2, -STRAND_IN],
    ]) {
      const n = 6;
      const w = (r1 - r0) / n;
      for (let k = 0; k < n; k++) {
        const len = Math.hypot(w, 0.006);
        const tooth = new THREE.Mesh(new THREE.PlaneGeometry(0.0012, len).rotateX(-Math.PI / 2), splice);
        tooth.position.set(0, 0, -(r0 + w * (k + 0.5)));
        tooth.rotation.y = (k % 2 ? 1 : -1) * Math.atan2(0.006, w);
        this.seam.add(tooth);
      }
    }
    this.group.add(this.seam);
    // Dark anodised cover between the strands (where the stoppers rise), matte so it doesn't
    // mirror the room as a bright stripe.
    const channel = new THREE.Mesh(this.strip(-STRAND_IN, STRAND_IN, BELT_Y - 0.0055, n), mat(0x2b2f31, { roughness: 0.66, metalness: 0.25 }));
    channel.receiveShadow = true;
    this.group.add(channel);

    for (const pts of [railIn, railOut]) {
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 600, RAIL_R, 8, true), M.rail);
      rail.castShadow = true;
      this.group.add(rail);
    }
    // A swept bed with an explicit horizontal across-track axis remains level
    // through both returns (Frenet frames can twist on a closed racetrack).
    const bedPositions: number[] = [];
    const bedIndices: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = pose(t, (i * this.L) / n);
      for (const [r, h] of [
        [-0.081, -0.006],
        [0.081, -0.006],
        [0.081, -0.054],
        [-0.081, -0.054],
      ]) {
        const v = side(p, r);
        bedPositions.push(v.x, BELT_Y + h, -v.y);
      }
      if (i < n)
        for (let j = 0; j < 4; j++) {
          const a = i * 4 + j,
            b = i * 4 + ((j + 1) % 4);
          bedIndices.push(a, a + 4, b, b, a + 4, b + 4);
        }
    }
    const bed = new THREE.BufferGeometry();
    bed.setAttribute('position', new THREE.Float32BufferAttribute(bedPositions, 3));
    bed.setIndex(bedIndices);
    const flat = bed.toNonIndexed();
    flat.computeVertexNormals();
    const body = new THREE.Mesh(flat, finish.graphite);
    body.receiveShadow = true;
    this.group.add(body);
    for (const z of [-t.radius, t.radius]) {
      const frame = new THREE.Group();
      for (const offset of [-0.08, 0.08]) {
        profile(frame, [-t.straight / 2, BELT_Y - 0.029, z + offset], [t.straight / 2, BELT_Y - 0.029, z + offset], 0.044);
        for (let x = -t.straight / 2 + 0.06; x < t.straight / 2; x += 0.24) {
          const clamp = hardware('GuideClip', x, BELT_Y, z + Math.sign(offset) * (BELT_W / 2 + 0.012));
          if (offset < 0) clamp.rotation.y = Math.PI;
          frame.add(clamp);
        }
      }
      for (let x = -t.straight / 2 + 0.12; x < t.straight / 2; x += 0.48) {
        for (const offset of [-0.079, 0.079]) {
          block(frame, x, BELT_Y - 0.053, z + offset, 0.046, 0.012, 0.052, finish.graphite);
          for (const dx of [-0.016, 0.016]) round(frame, x + dx, BELT_Y - 0.046, z + offset + Math.sign(offset) * 0.018, 0.003, 0.004, M.rail, 8);
        }
      }
      batch(frame);
      this.group.add(frame);
    }
  }

  /** Extent of the line itself (belt, movers, stations), without the table. */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const sv of this.stations) box.expandByObject(sv.group);
    box.expandByObject(this.springBases.group);
    box.expandByObject(this.dial.group);
    box.expandByObject(this.cartridges.group);
    for (const mv of this.movers) box.expandByObject(mv.root);
    box.expandByPoint(new THREE.Vector3(0, 0, 0));
    box.expandByPoint(new THREE.Vector3(this.cfg.track.straight / 2 + this.cfg.track.radius, 0, 0));
    box.expandByPoint(new THREE.Vector3(-this.cfg.track.straight / 2 - this.cfg.track.radius, 0, 0));
    return box;
  }

  update(sample: Sample, fb: { moverS(sample: Sample, i: number): number }, dt: number): void {
    const f: Frame = sample.b;
    this.movers.forEach((mv, i) => mv.update(sample.a.movers[i], pose(this.cfg.track, fb.moverS(sample, i)), BELT_Y));

    this.beltTravel += f.beltSpeed * dt;
    this.beltTex.offset.y = -this.beltTravel / RIB;
    // The belt's splice travels round with it.
    const sp = pose(this.cfg.track, ((this.beltTravel % this.L) + this.L) % this.L);
    this.seam.position.set(sp.x, BELT_Y - 0.0016, -sp.y);
    this.seam.rotation.y = sp.heading;

    this.stations.forEach((sv, i) => sv.update(sample.a, f, sample.alpha, i, sample.t));
    this.springBases.update(sample.a, sample.t);
    this.dial.update(sample.a, sample.t);
    this.cartridges.update(sample.a, f, sample.alpha);
  }
}
