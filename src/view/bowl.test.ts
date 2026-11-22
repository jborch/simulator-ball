import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BOWL,
  HOUSING_ENVELOPE as env,
  PITCH,
  RAMP_R,
  capsuleGap,
  floorAt,
  housingBowlLayout,
  housingCapsules,
  laneAngle,
  laneAt,
  planRadius,
  reach,
  segmentDistance3,
  shellBottom,
  shellPoints,
} from './bowl';

const layout = housingBowlLayout(env);
const caps = (ms: THREE.Matrix4[]) => ms.map((m) => housingCapsules(env, m));
const minGap = (a: ReturnType<typeof caps>, b: ReturnType<typeof caps>, same: boolean) => {
  let gap = Infinity;
  a.forEach((x, i) => b.forEach((y, j) => (same && i === j ? null : x.forEach((cx) => y.forEach((cy) => (gap = Math.min(gap, capsuleGap(cx, cy))))))));
  return gap;
};

describe('segmentDistance3', () => {
  it('measures crossing, parallel and skew segments', () => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    expect(segmentDistance3(v(-1, 0, 0), v(1, 0, 0), v(0, 1, -1), v(0, 1, 1))).toBeCloseTo(1);
    expect(segmentDistance3(v(0, 0, 0), v(1, 0, 0), v(0, 0.5, 0), v(1, 0.5, 0))).toBeCloseTo(0.5);
    expect(segmentDistance3(v(0, 0, 0), v(1, 0, 0), v(2, 0, 0), v(3, 0, 0))).toBeCloseTo(1);
  });
});

describe('housing bowl layout', () => {
  const lane = [...layout.lying, ...layout.tipping, ...layout.upright];

  it('fills the well, the track and the discharge', () => {
    expect(layout.pile.length).toBeGreaterThanOrEqual(18);
    expect(layout.lying.length).toBeGreaterThanOrEqual(5);
    expect(layout.tipping.length).toBe(1);
    expect(layout.upright.length).toBeGreaterThanOrEqual(6);
  });

  it('keeps every housing clear of every other (capsule distance ≥ sum of radii + clearance)', () => {
    expect(minGap(caps(layout.pile), caps(layout.pile), true)).toBeGreaterThan(0.0005);
    expect(minGap(caps(lane), caps(lane), true)).toBeGreaterThan(0.0005);
  });

  it('keeps the loose stock inside the well, on the floor, clear of the track even as it circulates', () => {
    for (const c of caps(layout.pile).flat()) {
      expect(Math.max(planRadius(c.a), planRadius(c.b)) + c.r).toBeLessThan(BOWL.lane - 0.003);
      expect(Math.min(c.a.y, c.b.y)).toBeLessThan(BOWL.rim);
    }
    for (const m of layout.pile) for (const p of shellPoints(env, m)) expect(p.y).toBeGreaterThan(floorAt(planRadius(p)) - 1e-4);
    // Lying down: within 25° of horizontal.
    for (const m of layout.pile) expect(Math.abs(new THREE.Vector3(0, 1, 0).transformDirection(m).y)).toBeLessThan(Math.sin(0.43));
  });

  it('lays the file down on the track, tangential, single file, against the wall', () => {
    for (const m of layout.lying) {
      const d = new THREE.Vector3(0, 1, 0).transformDirection(m);
      expect(Math.abs(d.y)).toBeLessThan(0.1);
      const base = new THREE.Vector3().setFromMatrixPosition(m);
      const radial = new THREE.Vector3(base.x, 0, base.z).normalize();
      expect(Math.abs(d.dot(radial))).toBeLessThan(0.35);
      // The turn under a point: the highest track height at its plan angle not above it.
      const turnUnder = (p: THREE.Vector3) => {
        const a0 = laneAngle(p.x, p.z, 0);
        const turns = [0, -1, -2].map((k) => a0 + 2 * Math.PI * k).filter((a) => a >= BOWL.start && a <= 0);
        return turns.filter((a) => laneAt(a) <= p.y + 0.001).sort((x, y) => laneAt(y) - laneAt(x))[0];
      };
      const near = turnUnder(new THREE.Vector3(base.x, base.y - env.R, base.z));
      for (const p of shellBottom(env, m)) {
        const lane = laneAt(laneAngle(p.x, p.z, near));
        expect(p.y).toBeGreaterThan(lane - 1e-4);
        expect(p.y).toBeLessThan(lane + 0.0015);
      }
      for (const p of shellPoints(env, m)) {
        expect(planRadius(p)).toBeLessThan(BOWL.wall - 0.0003);
        expect(planRadius(p)).toBeGreaterThan(BOWL.lane + 0.0015);
        // Below the next turn up.
        const a = laneAngle(p.x, p.z, near);
        if (a + 2 * Math.PI < 0) expect(p.y).toBeLessThan(laneAt(a + 2 * Math.PI) - BOWL.ledge);
      }
    }
    expect(PITCH).toBeGreaterThan(2 * reach(env) + BOWL.ledge);
  });

  it('stands the queue upright on the track, inside the wall, between the guides', () => {
    for (const m of layout.upright) {
      expect(new THREE.Vector3(0, 1, 0).transformDirection(m).y).toBeCloseTo(1);
      expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBeGreaterThanOrEqual(BOWL.top);
      for (const p of shellPoints(env, m)) if (p.y < BOWL.rim && p.z < 0) expect(planRadius(p)).toBeLessThan(BOWL.wall);
    }
    const all = [...caps(lane).flat()];
    for (const f of layout.fixtures) {
      if (f.r === RAMP_R) continue;
      for (const c of all) expect(capsuleGap(c, f)).toBeGreaterThan(0.0003);
    }
  });

  it('rests the up-ending housing on the track and the ramp wire, clear of everything else', () => {
    const [m] = layout.tipping;
    const bottom = shellBottom(env, m);
    expect(bottom[0].y).toBeGreaterThan(BOWL.top - 1e-4);
    expect(bottom[0].y).toBeLessThan(BOWL.top + 0.001);
    const wire = layout.ramp.slice(1).map((b, i) => ({ a: layout.ramp[i], b, r: RAMP_R }));
    const [shell] = housingCapsules(env, m);
    const touch = Math.min(...wire.map((w) => capsuleGap(w, shell)));
    expect(touch).toBeGreaterThanOrEqual(0);
    expect(touch).toBeLessThan(0.001);
    const others = caps([...layout.lying, ...layout.upright]).flat();
    for (const w of wire) for (const c of others) expect(capsuleGap(w, c)).toBeGreaterThan(0.0003);
  });
});

describe('measureHousing', () => {
  it('encloses the clip and both proud edges of the label land of the model', async () => {
    const { readFileSync } = await import('node:fs');
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { measureHousing } = await import('./bowl');
    const buf = readFileSync('public/models/housing.glb');
    const gltf = await new Promise<{ scene: THREE.Group }>((ok, fail) =>
      new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '', ok, fail),
    );
    gltf.scene.traverse((o) => (o.visible = !/_label$/.test(o.name)));
    const m = measureHousing(gltf.scene);
    expect(m.R).toBeCloseTo(env.R, 4);
    expect(m.lugs.length).toBe(env.lugs.length);
    m.lugs.forEach((l, i) => {
      expect(l.off + l.r).toBeLessThanOrEqual(env.lugs[i].off + env.lugs[i].r + 1e-4);
      expect(l.dir.dot(env.lugs[i].dir)).toBeGreaterThan(0.999);
    });
    // Every visible vertex is inside the envelope.
    const caps = housingCapsules(env, new THREE.Matrix4());
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        expect(Math.min(...caps.map((c) => segmentDistance3(v, v, c.a, c.b) - c.r))).toBeLessThan(2e-5);
      }
    });
  });
});
