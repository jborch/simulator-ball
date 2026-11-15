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

  test('every camera is mounted above the belt, inside the loop, and looks down at its station', () => {
    const inner = LINE.track.radius * 2;
    for (const cam of CAMERAS) {
      const { position, target } = cameraPose(LINE, cam);
      expect(position.y, cam.id).toBeGreaterThan(BELT_Y + 0.3);
      expect(target.y, cam.id).toBeLessThan(position.y);
      // Masts stand between the two straights, clear of the opposite belt.
      expect(-cam.mount.r, cam.id).toBeLessThan(inner - 0.05);
      expect(position.distanceTo(target), cam.id).toBeLessThan(1.5);
    }
  });

  test('camera ids are unique', () => {
    expect(new Set(CAMERAS.map((c) => c.id)).size).toBe(CAMERAS.length);
  });
});
