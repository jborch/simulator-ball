import type { Frame } from '../sim/protocol';
import { forward } from '../sim/track';

export interface Sample {
  /** Frame at or just before render time (discrete state comes from here). */
  a: Frame;
  b: Frame;
  alpha: number;
  /** Sim time being rendered. */
  t: number;
}

/**
 * Buffers frames from the host and renders slightly in the past, interpolating between the
 * two frames that bracket render time. The delay absorbs network jitter between frames.
 */
export class FrameBuffer {
  private frames: Frame[] = [];
  /** Estimated sim time minus local time (seconds). */
  private offset: number | null = null;

  constructor(
    private readonly loopLength: number,
    private readonly delay = 0.15,
    private readonly keep = 30,
  ) {}

  push(frame: Frame, localNow: number): void {
    this.frames.push(frame);
    if (this.frames.length > this.keep) this.frames.shift();
    // Late arrivals only make the estimate smaller, so track the max and let it relax slowly.
    const target = frame.t - localNow;
    if (this.offset === null || target > this.offset) this.offset = target;
    else this.offset += (target - this.offset) * 0.01;
  }

  /** Forgets all frames, e.g. after reconnecting to a server whose sim time may have restarted. */
  reset(): void {
    this.frames = [];
    this.offset = null;
  }

  latest(): Frame | null {
    return this.frames.at(-1) ?? null;
  }

  sample(localNow: number): Sample | null {
    const fs = this.frames;
    if (fs.length === 0 || this.offset === null) return null;
    const t = localNow + this.offset - this.delay;
    if (t <= fs[0].t) return { a: fs[0], b: fs[0], alpha: 0, t };
    for (let i = fs.length - 1; i > 0; i--) {
      const a = fs[i - 1];
      const b = fs[i];
      if (t >= a.t && t <= b.t) return { a, b, alpha: b.t > a.t ? (t - a.t) / (b.t - a.t) : 1, t };
    }
    const last = fs[fs.length - 1];
    return { a: last, b: last, alpha: 0, t };
  }

  /** Interpolated loop position of mover index i (movers only move forward, so wrap is safe). */
  moverS(sample: Sample, i: number): number {
    const sa = sample.a.movers[i].s;
    const sb = sample.b.movers[i].s;
    const s = sa + forward(sa, sb, this.loopLength) * sample.alpha;
    return s >= this.loopLength ? s - this.loopLength : s;
  }
}
