import './style.css';
import { setupControls, type ControlState } from './controls';
import { CONFIG } from './config';
import { discPixelCount } from './geometry';
import { History } from './graph';
import { render } from './render';
import { Simulation } from './simulation';

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const stat = document.getElementById('stat')!;

function deviceSize(): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  return { w: Math.round(window.innerWidth * dpr), h: Math.round(window.innerHeight * dpr) };
}

const initial = deviceSize();
canvas.width = initial.w;
canvas.height = initial.h;

const sim = new Simulation(initial.w, initial.h);
const history = new History(initial.w);
const fullDisc = discPixelCount(CONFIG.ball.radius);
const state: ControlState = { paused: false, speed: CONFIG.speeds[0] };

setupControls(state, () => {
  sim.reset();
  history.clear();
  stat.textContent = '0';
});

window.addEventListener('resize', () => {
  const { w, h } = deviceSize();
  canvas.width = w;
  canvas.height = h;
  sim.resize(w, h);
  history.resize(w);
});

function frame(): void {
  if (!state.paused) {
    sim.step(state.speed);
    history.push(sim.value, state.speed);
    stat.textContent = String(sim.value);
  }
  render(ctx, sim, history, fullDisc);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
