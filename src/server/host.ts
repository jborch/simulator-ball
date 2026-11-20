// Simulation host: owns the one simulation of the line, runs it in real time and streams it to
// every connected viewer. The CATCH.AI reporter runs here too, so it uses the API key directly.
// Transport-agnostic: viewers are plain callbacks (see ws.ts for the WebSocket side).
import { CatchAiApi } from '../catchai/api';
import { Reporter, type ReporterStatus } from '../catchai/reporter';
import { catalogue } from '../catchai/catalogue';
import type { Command, ToClient } from '../sim/protocol';
import { Simulation } from '../sim/simulation';
import { type Incident, type IncidentKind, INCIDENT_TEXT } from '../sim/incidents';
import type { Lighting, SimEvent } from '../sim/types';

export interface HostOptions {
  seed?: number;
  /** Scene seed and lighting (SCENE_SEED, SCENE_LIGHTING). Default: a new seed every run, daylight. */
  scene?: { seed?: number; lighting?: Lighting };
  /** Called when a visible incident starts or ends: the ground truth for vision tests. */
  onIncident?: (record: IncidentRecord) => void;
  /** `noAuth`: the CATCH.AI server has authentication off, so no API key is needed. */
  /** `timeOffsetHours`: report every time this many hours earlier (CATCHAI_TIME_OFFSET_HOURS). */
  catchai?: { url: string; apiKey?: string; noAuth?: boolean; enabled: boolean; timeOffsetHours?: number };
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

export interface IncidentRecord {
  event: 'start' | 'end';
  /** Wall-clock time (ISO 8601), to match against camera recordings. */
  time: string;
  id: number;
  kind: IncidentKind;
  station: string;
  moverId?: number;
}

/** If the host stalls longer than this, skip ahead instead of replaying the gap. */
const MAX_CATCH_UP_S = 5;
/** Recent events sent to a viewer when it connects, so its log isn't empty. */
const RECENT_EVENTS = 200;

export class LineHost {
  readonly sim: Simulation;
  private readonly viewers = new Set<Viewer>();
  private readonly opts: Required<Pick<HostOptions, 'stepMs' | 'frameMs'>>;
  private readonly log: (msg: string) => void;
  private reporter: Reporter | null = null;
  /** Reporting was turned on, but the server has no API key: shown as an error, nothing is sent. */
  private missingKey: number | null = null;
  private pending: SimEvent[] = [];
  private recent: SimEvent[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private last = 0;
  private lastFrame = 0;
  private loggedProblem: string | null = null;
  /** Visible incidents in progress, to log when they start and end. */
  private incidents = new Map<number, Incident>();

  constructor(private readonly options: HostOptions = {}) {
    const sceneSeed = options.scene?.seed ?? Math.floor(Math.random() * 0xffffffff);
    this.sim = new Simulation({ seed: options.seed ?? Date.now() & 0x7fffffff, epochMs: Date.now(), sceneSeed, lighting: options.scene?.lighting });
    this.opts = { stepMs: options.stepMs ?? 5, frameMs: options.frameMs ?? 1000 / 30 };
    this.log = options.log ?? (() => {});
    this.log(`scene: seed ${this.sim.state.scene.seed}, ${this.sim.state.scene.lighting} lighting`);
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
        const status = this.reportingStatus();
        this.logProblem(status);
        this.broadcast({ type: 'catchai', status });
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
    this.trackIncidents();
    const events = this.sim.drainEvents();
    if (events.length > 0) {
      this.reporter?.push(events);
      this.pending.push(...events);
      // A late viewer gets the recent log, not every snap curve (each is hundreds of samples).
      this.recent.push(...events.filter((e) => e.kind !== 'series'));
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
    const accepted = this.sim.command(command, origin);
    if (command.type === 'scene' && accepted) {
      const sc = this.sim.state.scene;
      this.log(`scene: seed ${sc.seed}, ${sc.lighting} lighting (from ${origin})`);
    }
    if (command.type === 'incident') {
      if (accepted) this.trackIncidents();
      else this.log(`incident ${command.kind}${command.station ? ` near ${command.station}` : ''} from ${origin}: nothing suitable there now`);
    }
  }

  /** Logs visible incidents that started or ended since the last call. */
  private trackIncidents(): void {
    const list = this.sim.state.plant.incidents.list;
    const time = new Date(this.sim.state.epochMs + this.sim.state.plant.t * 1000).toISOString();
    const record = (event: IncidentRecord['event'], x: Incident) => {
      const r: IncidentRecord = { event, time, id: x.id, kind: x.kind, station: x.station, ...(x.moverId !== undefined ? { moverId: x.moverId } : {}) };
      this.log(`incident #${x.id} ${event}: ${INCIDENT_TEXT[x.kind]} near ${x.station}${x.moverId !== undefined ? ` (mover ${x.moverId})` : ''}`);
      this.options.onIncident?.(r);
    };
    for (const x of list) {
      if (!this.incidents.has(x.id)) {
        this.incidents.set(x.id, x);
        record('start', x);
      }
    }
    if (this.incidents.size === list.length) return;
    const live = new Set(list.map((x) => x.id));
    for (const [id, x] of this.incidents) {
      if (live.has(id)) continue;
      this.incidents.delete(id);
      record('end', x);
    }
  }

  snapshot(viewer: Viewer): void {
    viewer.send(encode({ type: 'snapshot', state: this.sim.state }), false);
  }

  /** Turns CATCH.AI reporting on or off for the line (affects every viewer). */
  setReporting(enabled: boolean): void {
    const cfg = this.options.catchai;
    if (!cfg || enabled === (this.reporter !== null || this.missingKey !== null)) return;
    this.reporter?.stop();
    this.reporter = null;
    this.missingKey = null;
    if (enabled && !cfg.apiKey && !cfg.noAuth) {
      this.missingKey = Date.now();
    } else if (enabled) {
      const batch = this.sim.state.plc.batch;
      this.reporter = new Reporter(new CatchAiApi(cfg.url, cfg.apiKey), this.sim.cfg, batch && batch.state !== 'complete' ? batch : null, {
        timeOffsetMs: (cfg.timeOffsetHours ?? 0) * 3600_000,
      });
      void this.reporter.tick();
    }
    this.log(`CATCH.AI reporting ${enabled ? `on (${cfg.url})` : 'off'}`);
    this.broadcast({ type: 'catchai', status: this.reportingStatus() });
  }

  reportingStatus(): ReporterStatus | null {
    if (this.missingKey !== null && this.options.catchai) {
      return {
        state: 'error',
        url: this.options.catchai.url,
        line: catalogue(this.sim.cfg).line,
        queued: 0,
        sent: { items: 0, merges: 0, data: 0 },
        rejected: 0,
        dropped: 0,
        lastError: 'CATCHAI_API_KEY is not set on the server',
        problem: { kind: 'config', status: 0, detail: 'CATCHAI_API_KEY is not set on the server', since: this.missingKey, retryInMs: null },
        scopedIdBase: null,
      };
    }
    return this.reporter?.status() ?? null;
  }

  /** Logs when reporting starts failing, changes reason, or recovers (not every retry). */
  private logProblem(status: ReporterStatus | null): void {
    const p = status?.problem ?? null;
    const key = p ? `${p.kind}:${p.status}` : null;
    if (key === this.loggedProblem) return;
    if (p) this.log(`CATCH.AI problem (${p.kind}): ${p.detail}`);
    else if (this.loggedProblem && status) this.log('CATCH.AI reachable again');
    this.loggedProblem = key;
  }

  private broadcast(msg: ToClient): void {
    if (this.viewers.size === 0) return;
    const json = encode(msg);
    for (const v of this.viewers) v.send(json, msg.type === 'frame');
  }
}
