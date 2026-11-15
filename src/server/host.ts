// Simulation host: owns the one simulation of the line, runs it in real time and streams it to
// every connected viewer. The CATCH.AI reporter runs here too, so it uses the API key directly.
// Transport-agnostic: viewers are plain callbacks (see ws.ts for the WebSocket side).
import { CatchAiApi } from '../catchai/api';
import { Reporter, type ReporterStatus } from '../catchai/reporter';
import type { Command, ToClient } from '../sim/protocol';
import { Simulation } from '../sim/simulation';
import type { SimEvent } from '../sim/types';

export interface HostOptions {
  seed?: number;
  catchai?: { url: string; apiKey?: string; enabled: boolean };
  /** Simulation steps run about this often. */
  stepMs?: number;
  /** Frames (and the events since the last frame) go out this often. */
  frameMs?: number;
  log?: (msg: string) => void;
}

export interface Viewer {
  /**
   * `json` is one serialized ToClient message (serialized once for all viewers). Frames are
   * `droppable`: each one replaces the last, so a slow viewer may skip some.
   */
  send(json: string, droppable: boolean): void;
}

const encode = (msg: ToClient) => JSON.stringify(msg);

/** If the host stalls longer than this, skip ahead instead of replaying the gap. */
const MAX_CATCH_UP_S = 5;
/** Recent events sent to a viewer when it connects, so its log isn't empty. */
const RECENT_EVENTS = 200;

export class LineHost {
  readonly sim: Simulation;
  private readonly viewers = new Set<Viewer>();
  private readonly opts: Required<Omit<HostOptions, 'seed' | 'catchai' | 'log'>>;
  private readonly log: (msg: string) => void;
  private reporter: Reporter | null = null;
  private pending: SimEvent[] = [];
  private recent: SimEvent[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private last = 0;
  private lastFrame = 0;

  constructor(private readonly options: HostOptions = {}) {
    this.sim = new Simulation({ seed: options.seed ?? Date.now() & 0x7fffffff, epochMs: Date.now() });
    this.opts = { stepMs: options.stepMs ?? 5, frameMs: options.frameMs ?? 1000 / 30 };
    this.log = options.log ?? (() => {});
    this.sim.command({ type: 'start' }, 'system');
    if (options.catchai?.enabled) this.setReporting(true);
  }

  start(): void {
    if (this.timers.length) return;
    this.last = performance.now();
    this.timers.push(
      setInterval(() => this.step(performance.now()), this.opts.stepMs),
      setInterval(() => {
        void this.reporter?.tick();
        this.broadcast({ type: 'catchai', status: this.reportingStatus() });
      }, 1000),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.reporter?.stop();
  }

  /** Advances to `now` (ms, performance clock) and streams what happened. Public for tests. */
  step(now: number): void {
    this.sim.advance(Math.min((now - this.last) / 1000, MAX_CATCH_UP_S));
    this.last = now;
    const events = this.sim.drainEvents();
    if (events.length > 0) {
      this.reporter?.push(events);
      this.pending.push(...events);
      this.recent.push(...events);
      if (this.recent.length > RECENT_EVENTS * 2) this.recent = this.recent.slice(-RECENT_EVENTS);
    }
    if (now - this.lastFrame >= this.opts.frameMs) {
      this.lastFrame = now;
      if (this.pending.length > 0) {
        this.broadcast({ type: 'events', events: this.pending });
        this.pending = [];
      }
      this.broadcast({ type: 'frame', frame: this.sim.frame() });
    }
  }

  /** Adds a viewer and brings it up to date. Returns a function that removes it. */
  connect(viewer: Viewer): () => void {
    this.viewers.add(viewer);
    viewer.send(encode({ type: 'frame', frame: this.sim.frame() }), false);
    const recent = this.recent.slice(-RECENT_EVENTS);
    if (recent.length > 0) viewer.send(encode({ type: 'events', events: recent }), false);
    viewer.send(encode({ type: 'catchai', status: this.reportingStatus() }), false);
    return () => this.viewers.delete(viewer);
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  command(command: Command, origin: string): void {
    this.sim.command(command, origin);
  }

  snapshot(viewer: Viewer): void {
    viewer.send(encode({ type: 'snapshot', state: this.sim.state }), false);
  }

  /** Turns CATCH.AI reporting on or off for the line (affects every viewer). */
  setReporting(enabled: boolean): void {
    const cfg = this.options.catchai;
    if (enabled === (this.reporter !== null) || !cfg) return;
    this.reporter?.stop();
    this.reporter = null;
    if (enabled) {
      const batch = this.sim.state.plc.batch;
      this.reporter = new Reporter(new CatchAiApi(cfg.url, cfg.apiKey), this.sim.cfg, batch && batch.state !== 'complete' ? batch : null);
      void this.reporter.tick();
    }
    this.log(`CATCH.AI reporting ${enabled ? `on (${cfg.url})` : 'off'}`);
    this.broadcast({ type: 'catchai', status: this.reportingStatus() });
  }

  reportingStatus(): ReporterStatus | null {
    return this.reporter?.status() ?? null;
  }

  private broadcast(msg: ToClient): void {
    if (this.viewers.size === 0) return;
    const json = encode(msg);
    for (const v of this.viewers) v.send(json, msg.type === 'frame');
  }
}
