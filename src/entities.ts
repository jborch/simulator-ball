import type { Rect } from './geometry';

/** Something that moves up and down at a constant speed, reversing at the bounds. */
export class VerticalMover {
  y: number;
  private dir = 1;

  constructor(
    readonly height: number,
    readonly speed: number,
    y: number,
  ) {
    this.y = y;
  }

  step(scale: number, maxY: number): void {
    const limit = Math.max(0, maxY - this.height);
    this.y += this.dir * this.speed * scale;
    if (this.y <= 0) {
      this.y = Math.min(-this.y, limit);
      this.dir = 1;
    } else if (this.y >= limit) {
      this.y = Math.max(2 * limit - this.y, 0);
      this.dir = -1;
    }
  }

  clamp(maxY: number): void {
    this.y = Math.min(Math.max(this.y, 0), Math.max(0, maxY - this.height));
  }
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  trail: { x: number; y: number }[];
}

export function moverRect(m: VerticalMover, x: number, w: number): Rect {
  return { x, y: m.y, w, h: m.height };
}
