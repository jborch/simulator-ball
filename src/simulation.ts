import { CONFIG, type Config } from './config';
import { type Ball, VerticalMover, moverRect } from './entities';
import type { SimEvents } from './events';
import { type Rect, countOverlapPixels } from './geometry';

/** Ball speed in px/frame: crosses the world in crossFrames, clamped so a clean hit always gets a fully-inside frame. */
export function ballSpeed(worldWidth: number, cfg: Config = CONFIG): number {
  const target = worldWidth / cfg.ball.crossFrames;
  const max = cfg.detector.width - 2 * cfg.ball.radius;
  return Math.min(target, max);
}

export class Simulation {
  width = 0;
  height = 0;
  playHeight = 0;
  graphVisible = true;
  readonly head: VerticalMover;
  readonly detector: VerticalMover;
  ball: Ball | null = null;
  value = 0;
  events: SimEvents | null = null;
  private gapRemaining = 0;
  private shot = 0;
  private totalOverlap = 0;

  constructor(
    width: number,
    height: number,
    private readonly rng: () => number = Math.random,
    private readonly cfg: Config = CONFIG,
  ) {
    this.setSize(width, height);
    this.head = new VerticalMover(cfg.head.height, cfg.head.speed, (this.playHeight - cfg.head.height) / 2);
    this.detector = new VerticalMover(cfg.detector.height, cfg.detector.speed, (this.playHeight - cfg.detector.height) / 3);
  }

  private setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const graphFraction = this.graphVisible ? this.cfg.graph.heightFraction : 0;
    this.playHeight = Math.floor(height * (1 - graphFraction));
  }

  setGraphVisible(visible: boolean): void {
    this.graphVisible = visible;
    this.resize(this.width, this.height);
  }

  resize(width: number, height: number): void {
    this.setSize(width, height);
    this.head.clamp(this.playHeight);
    this.detector.clamp(this.playHeight);
    if (this.ball) {
      const r = this.ball.r;
      this.ball.y = Math.min(Math.max(this.ball.y, r), Math.max(r, this.playHeight - r));
    }
  }

  headRect(): Rect {
    return moverRect(this.head, 0, this.cfg.head.width);
  }

  detectorRect(): Rect {
    return moverRect(this.detector, this.width - this.cfg.detector.width, this.cfg.detector.width);
  }

  reset(): void {
    this.ball = null;
    this.value = 0;
    this.gapRemaining = 0;
    this.totalOverlap = 0;
  }

  step(scale: number): void {
    this.head.step(scale, this.playHeight);
    this.detector.step(scale, this.playHeight);

    if (this.ball) {
      this.moveBall(this.ball, scale);
      if (this.ball.x - this.ball.r > this.width) {
        this.events?.onBallExited({ shot: this.shot, totalOverlap: this.totalOverlap });
        this.ball = null;
        this.gapRemaining = this.cfg.ball.gapFrames;
      }
    } else {
      this.gapRemaining -= scale;
      if (this.gapRemaining <= 0) this.fire();
    }

    this.value = this.ball ? countOverlapPixels(this.ball, this.detectorRect()) : 0;
    if (this.ball) {
      this.totalOverlap += this.value * scale;
      this.events?.onBallFlight({ shot: this.shot, x: this.ball.x, y: this.ball.y, overlap: this.value });
    }
  }

  private fire(): void {
    const { radius, angleRangeDeg } = this.cfg.ball;
    const angle = ((this.rng() * 2 - 1) * angleRangeDeg * Math.PI) / 180;
    const speed = ballSpeed(this.width, this.cfg);
    const head = this.headRect();
    this.ball = {
      x: head.x + head.w,
      y: head.y + head.h / 2,
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
      r: radius,
      trail: [],
    };
    this.shot++;
    this.totalOverlap = 0;
    const det = this.detectorRect();
    this.events?.onBallFired({
      shot: this.shot,
      headY: this.ball.y,
      angleDeg: (-angle * 180) / Math.PI,
      detectorY: det.y + det.h / 2,
    });
  }

  private moveBall(b: Ball, scale: number): void {
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > this.cfg.ball.trailLength) b.trail.shift();

    b.x += b.vx * scale;
    b.y += b.vy * scale;
    const top = b.r;
    const bottom = this.playHeight - b.r;
    if (b.y < top) {
      b.y = 2 * top - b.y;
      b.vy = Math.abs(b.vy);
    } else if (b.y > bottom) {
      b.y = 2 * bottom - b.y;
      b.vy = -Math.abs(b.vy);
    }
  }
}
