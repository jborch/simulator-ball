// Simulation host. Runs in a dedicated Web Worker so the line keeps running in real time
// even when the tab is hidden (requestAnimationFrame stops and main-thread timers get throttled).
// The CATCH.AI reporter runs here too, for the same reason.
import { CatchAiApi } from '../catchai/api';
import { Reporter } from '../catchai/reporter';
import type { ToClient, ToHost } from './protocol';
import { Simulation } from './simulation';
import type { SimEvent } from './types';

interface WorkerScope {
  postMessage(msg: ToClient): void;
  onmessage: ((e: MessageEvent<ToHost>) => void) | null;
  location: { origin: string };
}
const scope = self as unknown as WorkerScope;

const FRAME_INTERVAL_MS = 1000 / 30;
/** If the host stalls longer than this, skip ahead instead of replaying the gap. */
const MAX_CATCH_UP_S = 5;
/** Dev-server path that proxies to CATCH.AI and adds the API key (see vite.config.ts). */
const CATCHAI_PROXY = '/catchai';
/** Events kept until the page says whether to report, so the start of the run isn't lost. */
const BACKLOG_CAP = 20_000;

const sim = new Simulation({ seed: Date.now() & 0x7fffffff, epochMs: Date.now() });
sim.command({ type: 'start' }, 'system');

let reporter: Reporter | null = null;
let backlog: SimEvent[] | null = [];

let last = performance.now();
let lastFrame = 0;

setInterval(() => {
  const now = performance.now();
  sim.advance(Math.min((now - last) / 1000, MAX_CATCH_UP_S));
  last = now;

  const events = sim.drainEvents();
  if (events.length > 0) {
    scope.postMessage({ type: 'events', events });
    if (reporter) reporter.push(events);
    else if (backlog && backlog.length < BACKLOG_CAP) backlog.push(...events);
  }
  if (now - lastFrame >= FRAME_INTERVAL_MS) {
    lastFrame = now;
    scope.postMessage({ type: 'frame', frame: sim.frame() });
  }
}, 5);

setInterval(() => {
  void reporter?.tick();
  scope.postMessage({ type: 'catchai', status: reporter?.status() ?? null });
}, 1000);

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'command') sim.command(msg.command, msg.origin);
  else if (msg.type === 'snapshot') scope.postMessage({ type: 'snapshot', state: structuredClone(sim.state) });
  else if (msg.type === 'catchai') {
    reporter?.stop();
    reporter = null;
    if (msg.enabled) {
      const api = new CatchAiApi(msg.url ?? scope.location.origin + CATCHAI_PROXY, msg.apiKey);
      const batch = sim.state.plc.batch;
      reporter = new Reporter(api, sim.cfg, batch && batch.state !== 'complete' ? batch : null);
      reporter.push(backlog ?? []);
      void reporter.tick();
    }
    backlog = null;
  }
};
