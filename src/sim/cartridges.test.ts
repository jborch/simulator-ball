// EM41's cartridge supply: nests (tubs) of 160, EM00 de-nesting into collets, the collet loop.
import { beforeAll, describe, expect, test } from 'vitest';
import { colletLoopLength, colletPoint, fillAt, tubSize } from './cartridges';
import { LINE } from './config';
import { processId, stationById, subProcessId } from './machine';
import { Simulation } from './simulation';
import { steadyConfig } from './testing';
import type { ItemProcessedEvent, ItemsMergedEvent, SimEvent } from './types';

const em00 = subProcessId(LINE, LINE.cartridges.denest);

describe('cartridges (25 min)', () => {
  let s: Simulation;
  let events: SimEvent[];
  let minGap = Infinity;
  beforeAll(() => {
    s = new Simulation({ seed: 12, cfg: steadyConfig() });
    s.command({ type: 'start' });
    events = [];
    const L = colletLoopLength(s.cfg);
    for (let t = 0; t < 1500; t += 0.05) {
      s.advance(0.05);
      events.push(...s.drainEvents());
      const us = s.state.plant.cartridges.collets.map((c) => c.u).sort((a, b) => a - b);
      us.forEach((u, i) => {
        const next = i + 1 < us.length ? us[i + 1] : us[0] + L;
        minGap = Math.min(minGap, next - u);
      });
    }
  }, 120_000);

  test('each cartridge comes out of one nest pocket, rides a collet and goes into exactly one pen', () => {
    const out = events.filter((e): e is ItemProcessedEvent => e.kind === 'processed' && e.process === em00);
    expect(out.length).toBeGreaterThan(400);
    const merged = events.filter((e): e is ItemsMergedEvent => e.kind === 'merged' && e.sourceType === 'Cartridge');
    expect(new Set(merged.map((m) => m.source)).size).toBe(merged.length);
    const ids = new Set(out.map((e) => e.scopedId));
    for (const m of merged) {
      expect(ids.has(m.source)).toBe(true);
      expect(m.process).toBe(processId(LINE, stationById(LINE, 'EM41')));
    }
    // Every pocket of a nest is used once, in order, before the next nest.
    const byNest = new Map<number, number[]>();
    for (const e of out) byNest.set(e.sourceScopedId!, [...(byNest.get(e.sourceScopedId!) ?? []), e.sourcePosition!]);
    expect(byNest.size).toBeGreaterThanOrEqual(3);
    const nests = [...byNest.values()];
    for (const pockets of nests) expect(pockets).toEqual(pockets.map((_, i) => i));
    for (const pockets of nests.slice(0, -1)) expect(pockets).toHaveLength(tubSize(LINE));
    for (const e of out) expect(e.carrier).toMatch(/^C(0[1-9]|1[0-2])$/);
  });

  test('collets keep their pitch on the loop', () => {
    expect(minGap).toBeGreaterThanOrEqual(LINE.cartridges.collets.pitch - 1e-9);
  });

  test('the cartridge goes in after the housing, as in the original', () => {
    const merges = events.filter((e): e is ItemsMergedEvent => e.kind === 'merged');
    const housing = new Map(merges.filter((m) => m.sourceType === 'Housing').map((m) => [m.target, m.logged]));
    const cartridge = merges.filter((m) => m.sourceType === 'Cartridge' && housing.has(m.target));
    expect(cartridge.length).toBeGreaterThan(300);
    for (const m of cartridge) expect(m.logged).toBeGreaterThan(housing.get(m.target)!);
  });
});

test('the collet loop is continuous, with the pick point by the belt and the fill point furthest out', () => {
  const c = LINE.cartridges.collets;
  const L = colletLoopLength(LINE);
  for (let i = 0; i < 400; i++) {
    const a = colletPoint(LINE, (L * i) / 400);
    const b = colletPoint(LINE, (L * (i + 1)) / 400);
    expect(Math.hypot(a.a - b.a, a.r - b.r)).toBeLessThan((L / 400) * 1.01);
  }
  const pick = colletPoint(LINE, 0);
  expect(pick.a).toBeCloseTo(0, 9);
  expect(pick.r).toBeCloseTo(c.pick, 9);
  const f = colletPoint(LINE, fillAt(LINE));
  expect(f.a).toBeCloseTo(0, 9);
  expect(f.r).toBeCloseTo(c.fill, 9);
});
