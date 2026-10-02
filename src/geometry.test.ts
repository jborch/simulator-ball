import { describe, expect, it } from 'vitest';
import { countOverlapPixels, discPixelCount } from './geometry';

describe('countOverlapPixels', () => {
  const det = { x: 100, y: 100, w: 40, h: 120 };

  it('is 0 when the ball is clear of the detector', () => {
    expect(countOverlapPixels({ x: 50, y: 150, r: 12 }, det)).toBe(0);
  });

  it('equals the full disc count on a clean hit', () => {
    expect(countOverlapPixels({ x: 120, y: 160, r: 12 }, det)).toBe(discPixelCount(12));
  });

  it('counts about half the disc when centered on the detector edge', () => {
    const half = countOverlapPixels({ x: 100, y: 160, r: 12 }, det);
    expect(half).toBe(discPixelCount(12) / 2);
  });

  it('gives a partial value when grazing a corner', () => {
    const v = countOverlapPixels({ x: 95, y: 95, r: 12 }, det);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(discPixelCount(12) / 2);
  });
});

describe('discPixelCount', () => {
  it('approximates πr²', () => {
    expect(Math.abs(discPixelCount(12) - Math.PI * 144)).toBeLessThan(20);
  });
});
