export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Counts 1 px grid cells whose centers lie inside both the circle and the rect. */
export function countOverlapPixels(c: Circle, rect: Rect): number {
  const x0 = Math.max(Math.floor(c.x - c.r), Math.floor(rect.x));
  const x1 = Math.min(Math.ceil(c.x + c.r), Math.ceil(rect.x + rect.w));
  const y0 = Math.max(Math.floor(c.y - c.r), Math.floor(rect.y));
  const y1 = Math.min(Math.ceil(c.y + c.r), Math.ceil(rect.y + rect.h));
  const r2 = c.r * c.r;
  let count = 0;
  for (let py = y0; py < y1; py++) {
    const cy = py + 0.5;
    if (cy < rect.y || cy >= rect.y + rect.h) continue;
    const dy = cy - c.y;
    for (let px = x0; px < x1; px++) {
      const cx = px + 0.5;
      if (cx < rect.x || cx >= rect.x + rect.w) continue;
      const dx = cx - c.x;
      if (dx * dx + dy * dy <= r2) count++;
    }
  }
  return count;
}

/** Pixel count of a full disc, used as the clean-hit reference level. */
export function discPixelCount(r: number): number {
  return countOverlapPixels({ x: 0, y: 0, r }, { x: -r - 1, y: -r - 1, w: 2 * r + 2, h: 2 * r + 2 });
}
