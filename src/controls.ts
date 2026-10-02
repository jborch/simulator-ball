import { CONFIG } from './config';

export interface ControlState {
  paused: boolean;
  speed: number;
}

export function setupControls(state: ControlState, onReset: () => void): void {
  const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
  const resetBtn = document.getElementById('reset') as HTMLButtonElement;
  const speedBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-speed]'));

  const sync = () => {
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('active', state.paused);
    for (const b of speedBtns) b.classList.toggle('active', Number(b.dataset.speed) === state.speed);
  };

  const togglePause = () => {
    state.paused = !state.paused;
    sync();
  };
  const setSpeed = (s: number) => {
    state.speed = s;
    sync();
  };

  pauseBtn.addEventListener('click', togglePause);
  resetBtn.addEventListener('click', onReset);
  for (const b of speedBtns) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'r' || e.key === 'R') {
      onReset();
    } else {
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx >= 0 && idx < CONFIG.speeds.length) setSpeed(CONFIG.speeds[idx]);
    }
  });

  // Keep focused buttons from also reacting to Space.
  for (const b of [pauseBtn, resetBtn, ...speedBtns]) b.addEventListener('keydown', (e) => e.code === 'Space' && e.preventDefault());

  sync();
}
