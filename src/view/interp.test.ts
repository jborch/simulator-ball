import { describe, expect, test } from 'vitest';
import type { Frame } from '../sim/protocol';
import { FrameBuffer } from './interp';

const frame = (t: number, s: number): Frame => ({
  t,
  epochMs: 0,
  machine: 'Execute',
  speed: 1,
  speedTarget: 1,
  beltSpeed: 0.25,
  movers: [{ id: 1, s, v: 0.25, status: 'empty', parts: [], srId: null, mark: null, laps: 0, lastLap: null }],
  stations: [],
  feeders: [],
  nests: [],
  tray: { count: 0, changing: 0 },
  batch: null,
  batchSettings: { size: 300, autoNext: true },
  counters: { good: 0, rejected: 0, traysOut: 0, bins: {} },
});

describe('FrameBuffer', () => {
  test('renders delay seconds behind the newest frame and interpolates', () => {
    const fb = new FrameBuffer(10, 0.1);
    fb.push(frame(1.0, 1.0), 100);
    fb.push(frame(1.1, 1.5), 100.1);
    const s = fb.sample(100.15)!;
    expect(s.t).toBeCloseTo(1.05);
    expect(fb.moverS(s, 0)).toBeCloseTo(1.25);
  });

  test('interpolates across the loop wrap', () => {
    const fb = new FrameBuffer(10, 0);
    fb.push(frame(0, 9.9), 0);
    fb.push(frame(1, 0.1), 1);
    expect(fb.moverS(fb.sample(0.5)!, 0)).toBeCloseTo(0);
  });

  test('holds the last frame instead of extrapolating', () => {
    const fb = new FrameBuffer(10, 0);
    fb.push(frame(0, 1), 0);
    fb.push(frame(1, 2), 1);
    expect(fb.moverS(fb.sample(5)!, 0)).toBe(2);
  });
});
