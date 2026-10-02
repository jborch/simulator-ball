import { CONFIG } from './config';

export interface ControlState {
  paused: boolean;
  speed: number;
  pinned: boolean;
  graphVisible: boolean;
}

export interface ControlActions {
  onReset: () => void;
  onGraphToggle: (visible: boolean) => void;
}

export function setupControls(state: ControlState, actions: ControlActions): void {
  const bar = document.getElementById('controls') as HTMLDivElement;
  const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
  const resetBtn = document.getElementById('reset') as HTMLButtonElement;
  const graphBtn = document.getElementById('graph') as HTMLButtonElement;
  const pinBtn = document.getElementById('pin') as HTMLButtonElement;
  const speedBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-speed]'));

  let hideTimer: number | undefined;
  const scheduleHide = () => {
    window.clearTimeout(hideTimer);
    bar.classList.remove('hidden');
    hideTimer = window.setTimeout(() => {
      if (!state.pinned && !bar.matches(':hover')) bar.classList.add('hidden');
    }, CONFIG.controls.autoHideMs);
  };

  const sync = () => {
    pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    pauseBtn.classList.toggle('active', state.paused);
    graphBtn.classList.toggle('active', state.graphVisible);
    pinBtn.classList.toggle('active', state.pinned);
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
  const toggleGraph = () => {
    state.graphVisible = !state.graphVisible;
    actions.onGraphToggle(state.graphVisible);
    sync();
  };
  const togglePin = () => {
    state.pinned = !state.pinned;
    sync();
    scheduleHide();
  };

  pauseBtn.addEventListener('click', togglePause);
  resetBtn.addEventListener('click', actions.onReset);
  graphBtn.addEventListener('click', toggleGraph);
  pinBtn.addEventListener('click', togglePin);
  for (const b of speedBtns) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.key === 'r' || e.key === 'R') {
      actions.onReset();
    } else if (e.key === 'g' || e.key === 'G') {
      toggleGraph();
    } else if (e.key === 'p' || e.key === 'P') {
      togglePin();
    } else {
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx >= 0 && idx < CONFIG.speeds.length) setSpeed(CONFIG.speeds[idx]);
    }
  });

  // Keep focused buttons from also reacting to Space.
  for (const b of [pauseBtn, resetBtn, graphBtn, pinBtn, ...speedBtns]) {
    b.addEventListener('keydown', (e) => e.code === 'Space' && e.preventDefault());
  }

  window.addEventListener('mousemove', scheduleHide);
  bar.addEventListener('mouseleave', scheduleHide);

  sync();
  scheduleHide();
}
