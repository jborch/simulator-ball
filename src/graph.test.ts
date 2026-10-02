import { describe, expect, it } from 'vitest';
import { History } from './graph';

describe('History', () => {
  it('commits one column per frame at 1×', () => {
    const h = new History(4);
    h.push(1, 1);
    h.push(2, 1);
    expect(h.at(0)).toBe(2);
    expect(h.at(1)).toBe(1);
  });

  it('keeps the max of 4 frames per column at 1/4×', () => {
    const h = new History(4);
    for (const v of [3, 9, 1, 0]) h.push(v, 0.25);
    expect(h.at(0)).toBe(9);
    h.push(5, 0.25);
    expect(h.at(0)).toBe(9);
  });

  it('preserves newest samples on resize', () => {
    const h = new History(4);
    for (const v of [1, 2, 3, 4]) h.push(v, 1);
    h.resize(2);
    expect(h.at(0)).toBe(4);
    expect(h.at(1)).toBe(3);
  });
});
