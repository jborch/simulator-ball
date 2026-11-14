// Simulation host. Runs in a dedicated Web Worker so the line keeps running in real time
// even when the tab is hidden (requestAnimationFrame stops and main-thread timers get throttled).
import type { ToClient, ToHost } from './protocol';
import { Simulation } from './simulation';

interface WorkerScope {
  postMessage(msg: ToClient): void;
  onmessage: ((e: MessageEvent<ToHost>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const FRAME_INTERVAL_MS = 1000 / 30;
/** If the host stalls longer than this, skip ahead instead of replaying the gap. */
const MAX_CATCH_UP_S = 5;

const sim = new Simulation({ seed: Date.now() & 0x7fffffff, epochMs: Date.now() });
sim.command({ type: 'start' }, 'system');

let last = performance.now();
let lastFrame = 0;

setInterval(() => {
  const now = performance.now();
  sim.advance(Math.min((now - last) / 1000, MAX_CATCH_UP_S));
  last = now;

  const events = sim.drainEvents();
  if (events.length > 0) scope.postMessage({ type: 'events', events });
  if (now - lastFrame >= FRAME_INTERVAL_MS) {
    lastFrame = now;
    scope.postMessage({ type: 'frame', frame: sim.frame() });
  }
}, 5);

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'command') sim.command(msg.command, msg.origin);
  else if (msg.type === 'snapshot') scope.postMessage({ type: 'snapshot', state: structuredClone(sim.state) });
};
