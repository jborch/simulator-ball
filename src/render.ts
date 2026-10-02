import { CONFIG } from './config';
import type { History } from './graph';
import type { Simulation } from './simulation';

const C = CONFIG.colors;

export function render(ctx: CanvasRenderingContext2D, sim: Simulation, history: History, fullDisc: number): void {
  const { width: w } = ctx.canvas;
  const h = ctx.canvas.height;
  const playH = sim.playHeight;

  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, w, playH);

  const head = sim.headRect();
  ctx.fillStyle = C.head;
  ctx.fillRect(head.x, head.y, head.w, head.h);

  const det = sim.detectorRect();
  ctx.fillStyle = sim.value > 0 ? C.detectorActive : C.detector;
  ctx.fillRect(det.x, det.y, det.w, det.h);

  const ball = sim.ball;
  if (ball) {
    const n = ball.trail.length;
    for (let i = 0; i < n; i++) {
      const p = ball.trail[i];
      const t = (i + 1) / (n + 1);
      ctx.fillStyle = `rgba(${C.trail}, ${0.25 * t})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ball.r * (0.4 + 0.6 * t), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = sim.value > 0 ? C.ballOverlap : C.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawGraph(ctx, history, fullDisc, playH, w, h - playH);
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  history: History,
  fullDisc: number,
  top: number,
  w: number,
  gh: number,
): void {
  ctx.fillStyle = C.graphBackground;
  ctx.fillRect(0, top, w, gh);
  ctx.fillStyle = C.divider;
  ctx.fillRect(0, top, w, 1);

  const bottom = top + gh - 1;
  const scale = (gh - 2) / (fullDisc * CONFIG.graph.headroom);

  const refY = Math.round(bottom - fullDisc * scale) + 0.5;
  ctx.strokeStyle = C.cleanHitLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, refY);
  ctx.lineTo(w, refY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = C.graphLine;
  ctx.lineWidth = CONFIG.graph.lineWidth;
  ctx.beginPath();
  const n = Math.min(history.capacity, w);
  for (let i = 0; i < n; i++) {
    const x = w - 1 - i;
    const y = bottom - history.at(i) * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
