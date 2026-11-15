import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { LINE } from '../sim/config';
import { pose } from '../sim/track';
import { BELT_Y, local, v3 } from './build';
import { CAMERAS, cameraPose, stationPoint } from './cameras';

describe('monitoring cameras', () => {
  test('station-local points land where StationView draws them', () => {
    for (const def of LINE.stations) {
      // StationView: group at the gate pose, turned by the heading; children at local(a, y, r).
      const p = pose(LINE.track, def.s);
      const group = new THREE.Group();
      group.position.copy(v3(p.x, p.y, BELT_Y));
      group.rotation.y = p.heading;
      group.updateMatrixWorld();
      const expected = local(0.1, 0.2, 0.3).applyMatrix4(group.matrixWorld);
      expect(stationPoint(LINE, { station: def.id, a: 0.1, y: 0.2, r: 0.3 }).distanceTo(expected)).toBeLessThan(1e-9);
    }
  });

  test('every camera stands inside the loop at about mover height and looks level across the belt', () => {
    const inner = LINE.track.radius * 2;
    for (const cam of CAMERAS) {
      const { position, target } = cameraPose(LINE, cam);
      expect(position.y - BELT_Y, cam.id).toBeGreaterThan(0.05);
      expect(position.y - BELT_Y, cam.id).toBeLessThan(0.25);
      // Level, or tilted down a little: the side labels must show above the guide rail.
      const dir = target.clone().sub(position).normalize();
      const pitch = THREE.MathUtils.radToDeg(Math.asin(dir.y));
      expect(pitch, cam.id).toBeLessThanOrEqual(0);
      expect(pitch, cam.id).toBeGreaterThan(-10);
      // Inside the loop (the side the labels and DataMatrix face), clear of the opposite belt.
      expect(cam.mount.r, cam.id).toBeLessThan(-0.2);
      expect(-cam.mount.r, cam.id).toBeLessThan(inner - 0.1);
      expect(position.distanceTo(target), cam.id).toBeLessThan(1);
    }
  });

  test('camera ids are unique', () => {
    expect(new Set(CAMERAS.map((c) => c.id)).size).toBe(CAMERAS.length);
  });
});
