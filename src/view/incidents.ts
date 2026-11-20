// Draws the visible incidents (src/sim/incidents.ts): loose pens on or beside the belt, parts
// dropped in a robot's working area, and how an incident changes a mover (a missing spring, a
// tilted or lost pen, a mover skewed where it jammed).
import * as THREE from 'three';
import type { LineConfig, PartType } from '../sim/config';
import type { IncidentFrame } from '../sim/protocol';
import { pose } from '../sim/track';
import { BELT_Y, local, side } from './build';
import type { Models } from './models';
import { AssemblyView, type MoverLook, type MoverView, housingPart } from './movers';

/** Height of a mover's top plate above the belt (where a dropped part lies). */
const PLATE_TOP = 0.026;
/** Radius of a part lying on its side (so it rests on the surface), by part. */
const LYING_R: Record<PartType, number> = { body: 0.0065, spring: 0.0048, springBase: 0.0048, cartridge: 0.0048, housing: 0.0085 };

export class IncidentsView {
  readonly group = new THREE.Group();
  /** Objects drawn for loose pens and dropped parts, by incident id. */
  private readonly items = new Map<number, THREE.Object3D>();

  constructor(
    private readonly cfg: LineConfig,
    private readonly models: Models,
    private readonly movers: MoverView[],
  ) {}

  update(incidents: IncidentFrame[]): void {
    const looks = new Map<number, MoverLook>();
    const live = new Set<number>();
    for (const inc of incidents) {
      if (inc.kind === 'droppedPart') {
        live.add(inc.id);
        this.placeDroppedPart(inc);
        continue;
      }
      if (inc.moverId !== undefined) {
        const look = looks.get(inc.moverId) ?? {};
        if (inc.kind === 'missingSpring') look.hide = [...(look.hide ?? []), 'spring'];
        if (inc.kind === 'emptyMover') look.hide = ['body', 'spring', 'springBase', 'cartridge', 'housing'];
        if (inc.kind === 'tiltedPen') look.tilt = inc.angle;
        if (inc.kind === 'jam') look.skew = inc.angle;
        looks.set(inc.moverId, look);
        continue;
      }
      live.add(inc.id);
      if (inc.kind === 'loosePen') this.placeLoosePen(inc);
    }
    for (const mv of this.movers) mv.look = looks.get(mv.id) ?? null;
    for (const [id, obj] of this.items) {
      if (live.has(id)) continue;
      obj.removeFromParent();
      this.items.delete(id);
    }
  }

  private item(inc: IncidentFrame, make: () => THREE.Object3D, parent: THREE.Object3D = this.group): THREE.Object3D {
    let obj = this.items.get(inc.id);
    if (!obj) {
      obj = make();
      this.items.set(inc.id, obj);
    }
    if (obj.parent !== parent) parent.add(obj);
    return obj;
  }

  /** A pen lying lengthwise on the belt, or where it fell beside it. */
  private placeLoosePen(inc: IncidentFrame): void {
    const parts = inc.parts ?? ['body', 'spring', 'springBase', 'cartridge', 'housing'];
    const obj = this.item(inc, () => {
      const a = new AssemblyView(this.cfg, this.models);
      a.show(parts);
      const g = new THREE.Group();
      // The pen's axis (y) turned to lie along the group's x, centred on its length.
      a.root.rotation.z = -Math.PI / 2;
      a.root.position.x = -0.06;
      g.add(a.root);
      return g;
    });
    const p = pose(this.cfg.track, inc.s ?? 0);
    const at = side(p, inc.offset ?? 0);
    const r = parts.includes('housing') ? LYING_R.housing : LYING_R.body;
    obj.position.set(at.x, BELT_Y + r, -at.y);
    obj.rotation.y = p.heading + inc.angle;
  }

  /** A part lying on a mover's top plate, beside the fixture (rides along with the mover). */
  private placeDroppedPart(inc: IncidentFrame): void {
    const mover = this.movers.find((m) => m.id === inc.moverId);
    if (!mover) return;
    const part = inc.part ?? 'spring';
    const obj = this.item(
      inc,
      () => {
        const model =
          part === 'housing' ? housingPart(this.models) : (part === 'springBase' ? this.models.spring_base : this.models[part === 'body' ? 'pen_body' : part]).clone(true);
        // Lying along the plate, centred on its length.
        model.rotation.z = -Math.PI / 2;
        model.position.x = -this.cfg.parts[part].length / 2;
        const g = new THREE.Group();
        g.add(model);
        return g;
      },
      mover.root,
    );
    obj.position.copy(local(inc.a ?? 0, PLATE_TOP + LYING_R[part], inc.r ?? -0.03));
    obj.rotation.y = inc.angle;
  }

}
