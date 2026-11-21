// The surroundings of the line, which vary from run to run (the scene seed) so footage for vision
// isn't one fixed moment: hall lighting (day, evening, night, a dim lamp), the movers' wear and
// colour, and people walking along the aisles or standing at a station while they clear a fault.
// Everything is derived from the seed and sim time, so every camera page draws the same scene.
import * as THREE from 'three';
import type { LineConfig } from '../sim/config';
import type { Frame } from '../sim/protocol';
import { pose } from '../sim/track';
import type { Lighting } from '../sim/types';
import { BELT_Y, side } from './build';
import type { Exposure } from './camerafx';
import type { RoomLight } from './environment';
import { cells } from './cells';
import { hardware } from './hardware';
import { fabricTexture } from './textures';
import type { MoverView } from './movers';
import type { Stage } from './stage';

/** Deterministic hash of integers → [0, 1). */
export function hash01(...n: number[]): number {
  let h = 0x9e3779b9;
  for (const x of n) {
    h = Math.imul(h ^ (Math.floor(x) | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/** Deterministic hash → [-1, 1). */
export const hashSigned = (...n: number[]) => hash01(...n) * 2 - 1;

/**
 * A camera's gain only partly makes up for poor light (as auto-exposure does, within limits): a
 * darker hall still gives a darker, noisier picture.
 */
interface LightPreset {
  hemi: number;
  sky: number;
  sun: number;
  sunColor: number;
  /** Key direction: off the view direction, and above the floor (rad; see Stage.key). */
  keyYaw: number;
  keyElevation: number;
  env: number;
  /** The room's light as the reflection/ambient probe sees it. */
  room: RoomLight;
  /** Ceiling lamps over the line (only lit when the hall is dark). */
  lamps: number;
  exposure: Exposure;
}

// Most of the ambient light comes from the room probe (bright strips overhead, darker floor), so
// undersides and the spaces under tables fall off; the hemisphere is only a weak fill.
const PRESETS: Record<Lighting, LightPreset> = {
  day: {
    hemi: 0.05,
    sky: 0xe2eaf1,
    sun: 2.9,
    sunColor: 0xfff3e2,
    keyYaw: 0.7,
    keyElevation: 0.9,
    env: 1.0,
    room: { strips: 12, stripColor: 0xfff4e4, room: 1, windows: 1.3, windowColor: 0xd5dee2 },
    lamps: 0,
    exposure: { gain: 1, flicker: 0.012, blur: 0.25 },
  },
  evening: {
    hemi: 0.12,
    sky: 0xffe8d4,
    sun: 1.5,
    sunColor: 0xffd6ad,
    keyYaw: 0.9,
    keyElevation: 0.7,
    env: 0.75,
    room: { strips: 6.5, stripColor: 0xffe4c8, room: 0.7, windows: 0.3, windowColor: 0xc9a88a },
    lamps: 1.5,
    exposure: { gain: 1.3, flicker: 0.025, blur: 0.35 },
  },
  night: {
    hemi: 0.08,
    sky: 0xb8c8ff,
    sun: 0.45,
    sunColor: 0xd4e0ff,
    keyYaw: 0.6,
    keyElevation: 1.05,
    env: 0.9,
    room: { strips: 3.6, stripColor: 0xdde7ff, room: 0.34, windows: 0.06, windowColor: 0x2a3550 },
    lamps: 4.5,
    exposure: { gain: 2.0, flicker: 0.04, blur: 0.5 },
  },
  dim: {
    hemi: 0.16,
    sky: 0xdfe8ff,
    sun: 0.8,
    sunColor: 0xfff2dd,
    keyYaw: 0.7,
    keyElevation: 0.95,
    env: 0.8,
    room: { strips: 3, stripColor: 0xfff0dd, room: 0.4, windows: 0.25, windowColor: 0x9aa7ad },
    lamps: 0,
    exposure: { gain: 1.5, flicker: 0.05, blur: 0.4 },
  },
};

/** A simple figure in work clothes; walks or stands. Origin at the feet, facing +z. */
class Person {
  readonly group = new THREE.Group();
  private readonly legs: THREE.Object3D[] = [];
  private readonly arms: THREE.Object3D[] = [];

  constructor(clothes: number, skin: number) {
    const torso = hardware('Smock');
    this.group.add(torso);
    for (const side of [-1, 1]) {
      const leg = hardware('Trouser', side * 0.09, 0.88, 0);
      const arm = hardware('Sleeve', side * 0.195, 1.413, 0);
      arm.rotation.z = side * 0.075;
      this.group.add(arm, leg);
      this.arms.push(arm);
      this.legs.push(leg);
    }
    // Garments share their finish across one operator, with subtle variation
    // between operators. The mask and badge keep their original finishes.
    const fabric = new THREE.MeshPhysicalMaterial({ color: clothes, map: fabricTexture(), roughness: 0.82, sheen: 0.6, sheenRoughness: 0.7, sheenColor: 0xffffff });
    const face = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.74 });
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (o.material.name === 'Cleanroom textile') o.material = fabric;
        if (o.material.name === 'Complexion') o.material = face;
      }
    });
    this.group.visible = false;
  }

  /** `phase`: walking cycle in radians; `reach`: 0..1, arms forward as when working at a machine. */
  pose(phase: number, walking: boolean, reach = 0): void {
    const swing = walking ? Math.sin(phase) * 0.45 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8 - reach * 1.2;
    this.arms[1].rotation.x = swing * 0.8 - reach * (1.0 + 0.2 * Math.sin(phase));
    // The rig origin follows the floor while the hips rise slightly on each step.
    this.group.position.y = walking ? Math.abs(Math.cos(phase)) * 0.02 : 0;
  }
}

const CLOTHES = [0xc9d6dc, 0xdfe3e2, 0xb6c9d4, 0xd7dcd7];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
/** Aisle along each straight, this far out from the belt (m). */
const AISLE = 1.85;
const WALK_SPEED = 1.2;
/** A walk past may start in each slot of this many seconds. */
const WALK_SLOT = 40;

export class SceneView {
  private readonly people: Person[] = [];
  private readonly lamps: THREE.PointLight[] = [];
  private key = '';
  private preset: LightPreset = PRESETS.day;

  constructor(
    private readonly cfg: LineConfig,
    private readonly stage: Stage,
    private readonly movers: MoverView[],
  ) {
    for (let i = 0; i < 4; i++) {
      const p = new Person(CLOTHES[i % CLOTHES.length], SKIN[i % SKIN.length]);
      p.group.userData.track = { cls: 'person', id: `person-${i + 1}` };
      this.people.push(p);
      stage.scene.add(p.group);
    }
    // Ceiling lamps along the line (no shadows: cheap), lit in the evening and at night.
    const S = cfg.track.straight;
    for (const x of [-S / 3, 0, S / 3]) {
      for (const y of [-1, 1]) {
        const lamp = new THREE.PointLight(0xffeed9, 0, 6, 2);
        lamp.position.set(x, BELT_Y + 1.6, -y * (cfg.track.radius + 0.6));
        this.lamps.push(lamp);
        stage.scene.add(lamp);
      }
    }
  }

  get exposure(): Exposure {
    return this.preset.exposure;
  }

  update(f: Frame): void {
    const { seed, lighting } = f.scene;
    const key = `${seed}:${lighting}`;
    if (key !== this.key) {
      this.key = key;
      this.applyLighting(seed, lighting);
      this.movers.forEach((m) => m.setWear(seed));
    }
    this.updatePeople(f, seed);
  }

  private applyLighting(seed: number, lighting: Lighting): void {
    const p = PRESETS[lighting];
    // The same preset still differs a little from one installation (seed) to the next.
    const v = (k: number, spread: number) => 1 + hashSigned(seed, 7001, k) * spread;
    this.preset = { ...p, exposure: { ...p.exposure, gain: p.exposure.gain * v(1, 0.1) } };
    const { hemi, sun, stage } = { hemi: this.stage.hemi, sun: this.stage.sun, stage: this.stage };
    (stage.scene.fog as THREE.Fog).color.setHex(
      lighting === 'night' ? 0x2c383c : lighting === 'evening' ? 0x7f8079 : lighting === 'dim' ? 0x6d7573 : 0x8f9795,
    );
    hemi.intensity = p.hemi * v(2, 0.12);
    hemi.color.setHex(p.sky);
    sun.intensity = p.sun * v(3, 0.15);
    sun.color.setHex(p.sunColor);
    // Each installation's key falls in a slightly different direction.
    stage.key.yaw = p.keyYaw + hashSigned(seed, 7001, 4) * 0.12;
    stage.key.elevation = p.keyElevation + hashSigned(seed, 7001, 6) * 0.05;
    stage.setRoom(p.room);
    stage.scene.environmentIntensity = p.env * v(5, 0.15);
    this.lamps.forEach((l, i) => {
      // Now and then one lamp is out.
      l.intensity = p.lamps > 0 && hash01(seed, 7002, i) > 0.15 ? p.lamps * v(10 + i, 0.2) : 0;
      l.visible = l.intensity > 0;
    });
  }

  /**
   * People: someone walks along an aisle now and then, and an operator stands at a station while
   * one of its robots is down (clearing the fault).
   */
  private updatePeople(f: Frame, seed: number): void {
    const t = f.t;
    let used = 0;
    const next = () => (used < this.people.length ? this.people[used++] : null);

    f.stations.forEach((st, i) => {
      if (st.fault <= 0) return;
      const person = next();
      if (!person) return;
      const def = this.cfg.stations[i];
      const p = pose(this.cfg.track, def.s);
      const cell = cells.find((c) => c.z * p.y < 0 && Math.abs(p.x - c.x) <= c.w / 2);
      const stand = cell ? Math.abs(cell.z) + cell.d / 2 - this.cfg.track.radius + 0.19 : 1.1;
      const at = side(p, stand);
      person.group.visible = true;
      person.group.position.set(at.x, 0, -at.y);
      // Facing the belt (inward), working with both hands.
      person.group.rotation.y = p.heading;
      person.pose(t * 1.7 + i, false, 0.7);
    });

    const S = this.cfg.track.straight;
    const half = S / 2 + 1.5;
    for (const k of [Math.floor(t / WALK_SLOT), Math.floor(t / WALK_SLOT) - 1]) {
      if (k < 0 || hash01(seed, k, 801) > 0.55) continue;
      const start = (k + hash01(seed, k, 802) * 0.5) * WALK_SLOT;
      const speed = WALK_SPEED * (0.8 + 0.4 * hash01(seed, k, 803));
      const d = (t - start) * speed;
      if (d < 0 || d > 2 * half) continue;
      const person = next();
      if (!person) break;
      const dir = hash01(seed, k, 804) < 0.5 ? 1 : -1;
      const top = hash01(seed, k, 805) < 0.5;
      const y = (top ? 1 : -1) * (this.cfg.track.radius + AISLE);
      person.group.visible = true;
      person.group.position.set(dir * (-half + d), 0, -y);
      person.group.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      person.pose((d / 0.7) * Math.PI, true);
    }
    for (let i = used; i < this.people.length; i++) this.people[i].group.visible = false;
  }
}
