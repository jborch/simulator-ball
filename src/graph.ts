/** Scrolling history in simulation steps: each column covers one 1× frame and keeps the max sample within it. */
export class History {
  private buffer: Float32Array;
  private head = 0;
  private pending = 0;
  private progress = 0;

  constructor(capacity: number) {
    this.buffer = new Float32Array(Math.max(1, capacity));
  }

  get capacity(): number {
    return this.buffer.length;
  }

  push(value: number, scale: number): void {
    this.pending = Math.max(this.pending, value);
    this.progress += scale;
    // Small epsilon guards against float drift for fractional scales.
    while (this.progress >= 1 - 1e-9) {
      this.buffer[this.head] = this.pending;
      this.head = (this.head + 1) % this.buffer.length;
      this.progress -= 1;
      this.pending = 0;
    }
  }

  /** Value at age i (0 = newest committed column). */
  at(i: number): number {
    const n = this.buffer.length;
    return this.buffer[(this.head - 1 - i + n * 2) % n];
  }

  resize(capacity: number): void {
    const next = new Float32Array(Math.max(1, capacity));
    const keep = Math.min(next.length, this.buffer.length);
    for (let i = 0; i < keep; i++) next[keep - 1 - i] = this.at(i);
    this.buffer = next;
    this.head = keep % next.length;
  }

  clear(): void {
    this.buffer.fill(0);
    this.head = 0;
    this.pending = 0;
    this.progress = 0;
  }
}
