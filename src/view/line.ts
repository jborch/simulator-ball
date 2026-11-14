import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import type { Frame } from '../sim/protocol';
import { pose, trackLength } from '../sim/track';
import { BELT_Y, BELT_W, M, RIB, TABLE, box, side, v3 } from './build';
import type { Sample } from './interp';
import type { Models } from './models';
import { MoverView } from './movers';
import { StationView } from './station';
import { beltTexture } from './textures';

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
      const mv = new MoverView(i + 1, cfg, models);
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

  /** Extent of the line itself (belt, movers, stations), without the table. */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const sv of this.stations) box.expandByObject(sv.group);
    for (const mv of this.movers) box.expandByObject(mv.root);
    return box;
  }

  update(sample: Sample, fb: { moverS(sample: Sample, i: number): number }, dt: number): void {
    const f: Frame = sample.b;
    this.movers.forEach((mv, i) => mv.update(sample.a.movers[i], pose(this.cfg.track, fb.moverS(sample, i)), BELT_Y));

    this.beltTravel += f.beltSpeed * dt;
    this.beltTex.offset.y = -this.beltTravel / RIB;

    this.stations.forEach((sv, i) => sv.update(sample.a, f, sample.alpha, i, sample.t));
  }
}
