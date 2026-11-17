// UN01's spring base sub-line, drawn in the station-local frame of the point beside the loop where
// the orienter stands (a along travel, r outward): the spring base bowl and track, EM13 turning
// and checking each part, and the distribution conveyor along the straight to the four EM14
// presses, with a diverter and a pick cup at each.
import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import { heldLength } from '../sim/layout';
import type { Frame } from '../sim/protocol';
import { pose } from '../sim/track';
import { BELT_Y, M, TABLE, cyl, label, local, mat, span, v3 } from './build';
import { FeederView } from './devices';
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
