import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { countOverlapPixels, discPixelCount } from './geometry';
import { Simulation, ballSpeed } from './simulation';

describe('ballSpeed', () => {
  it('crosses the world in crossFrames on narrow screens', () => {
    expect(ballSpeed(1800)).toBeCloseTo(1800 / CONFIG.ball.crossFrames);
  });

  it('is clamped to detector width minus ball diameter', () => {
    expect(ballSpeed(10000)).toBe(CONFIG.detector.width - 2 * CONFIG.ball.radius);
  });
});

describe('Simulation', () => {
  it('records a clean hit for a flat shot aligned with the detector', () => {
    // Very wide world forces the clamped (worst-case) speed.
    const sim = new Simulation(8000, 1000, () => 0.5);
    let clean = false;
    for (let i = 0; i < 2000 && !clean; i++) {
      // Pin both movers to the same center so the shot lines up with the detector.
      sim.head.y = (sim.playHeight - sim.head.height) / 2;
      sim.detector.y = (sim.playHeight - sim.detector.height) / 2;
      sim.step(1);
      if (sim.ball) {
        // Disc pixel count varies slightly with sub-pixel position, so compare against the ball's own full count.
        const full = countOverlapPixels(sim.ball, { x: 0, y: 0, w: sim.width, h: sim.playHeight });
        clean = sim.value === full;
      }
    }
    expect(clean).toBe(true);
    expect(Math.abs(sim.value - discPixelCount(CONFIG.ball.radius))).toBeLessThan(10);
  });

  it('expands the play area to full height when the graph is hidden', () => {
    const sim = new Simulation(1920, 1000);
    expect(sim.playHeight).toBe(Math.floor(1000 * (1 - CONFIG.graph.heightFraction)));
    sim.setGraphVisible(false);
    expect(sim.playHeight).toBe(1000);
  });

  it('keeps the ball inside the play area while bouncing', () => {
    const sim = new Simulation(1920, 1080, () => 1);
    for (let i = 0; i < 1000; i++) {
      sim.step(1);
      if (sim.ball) {
        expect(sim.ball.y).toBeGreaterThanOrEqual(sim.ball.r);
        expect(sim.ball.y).toBeLessThanOrEqual(sim.playHeight - sim.ball.r);
      }
    }
  });
});
