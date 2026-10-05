import './style.css';
import { CatchAiConnection } from './catchai/connection';
import { bindStatusDot, installConsoleApi } from './catchai/console';
import { CatchAiReporter } from './catchai/reporter';
import { setupControls, type ControlState } from './controls';
import { CONFIG, validateConfig } from './config';
import { discPixelCount } from './geometry';
import { History } from './graph';
import { render } from './render';
import { Simulation } from './simulation';
import { TimeSync, installTimeSyncConsole } from './timesync';

const configError = validateConfig(CONFIG);
if (configError) {
  document.body.textContent = configError;
  throw new Error(configError);
}

const canvas = document.getElementById('world') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function deviceSize(): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  return { w: Math.round(window.innerWidth * dpr), h: Math.round(window.innerHeight * dpr) };
}

const initial = deviceSize();
canvas.width = initial.w;
canvas.height = initial.h;

const sim = new Simulation(initial.w, initial.h);
const history = new History(initial.w);

const timeSync = new TimeSync();
installTimeSyncConsole(timeSync);
timeSync.restore();

const catchAi = new CatchAiConnection();
sim.events = new CatchAiReporter(catchAi.enqueue, CONFIG.catchAi, () => timeSync.date());
installConsoleApi(catchAi);
bindStatusDot(document.getElementById('catchai-status')!, catchAi);
catchAi.restore();
const fullDisc = discPixelCount(CONFIG.ball.radius);
const state: ControlState = { paused: false, speed: CONFIG.speeds[0], pinned: false, graphVisible: true, clockVisible: true };
const clockEl = document.getElementById('clock')!;

function formatClock(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

setupControls(state, {
  onReset: () => {
    sim.reset();
    history.clear();
  },
  onGraphToggle: (visible) => sim.setGraphVisible(visible),
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
  }
  render(ctx, sim, history, fullDisc);
  if (state.clockVisible) {
    clockEl.textContent = formatClock(timeSync.date());
    const ts = timeSync.state;
    clockEl.classList.toggle('unsynced', ts === 'pending' || ts === 'error');
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
