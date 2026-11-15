// Sends the line's MES events to CATCH.AI. Runs next to the sim (in the worker) and is driven by
// tick(): first the setup (devices, processes, properties, events), then the queued data in order.
import type { LineConfig } from '../sim/config';
import type { Batch, SimEvent } from '../sim/types';
import { ApiError, type CatchAiApi } from './api';
import { catalogue, type Catalogue } from './catalogue';
import { Mapper, type Outbound } from './mapper';
import { setup, type Setup } from './setup';
import type { BulkResult, NamedPeriod } from './types';

export type ReporterState = 'connecting' | 'ok' | 'error';

export interface ReporterStatus {
  state: ReporterState;
  url: string;
  line: string;
  queued: number;
  sent: { items: number; merges: number; data: number };
  /** Entries the server refused (per-entry validation errors). Not retried. */
  rejected: number;
  /** Entries dropped because the queue was full while the server was unreachable. */
  dropped: number;
  lastError: string | null;
  scopedIdBase: number | null;
}

export interface ReporterOptions {
  now?: () => number;
  /** Entries per request. */
  maxBatch?: number;
  queueCap?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
}

const ENDPOINT = { processed: '/api/v2/item/processed', merged: '/api/v2/item/merge', data: '/api/v2/devicedata' } as const;
/** Within a stretch between batch boundaries items go first, so merges and data can refer to them. */
const ORDER = ['processed', 'merged', 'data'] as const;

export class Reporter {
  private readonly cat: Catalogue;
  private readonly now: () => number;
  private readonly opts: Required<Omit<ReporterOptions, 'now'>>;
  /** Events waiting for setup to finish (keys and the scoped id base are needed to map them). */
  private raw: SimEvent[] = [];
  private out: Outbound[] = [];
  private keys: Setup | null = null;
  private mapper: Mapper | null = null;
  private period: NamedPeriod | null = null;
  private busy = false;
  private stopped = false;
  private backoff = 0;
  private nextAttempt = 0;
  private state: ReporterState = 'connecting';
  private lastError: string | null = null;
  private readonly sent = { items: 0, merges: 0, data: 0 };
  private rejected = 0;
  private dropped = 0;

  /** `current` is the batch already running when reporting starts, if any. */
  constructor(
    private readonly api: CatchAiApi,
    cfg: LineConfig,
    private readonly current: Pick<Batch, 'name' | 'startedAt'> | null,
    opts: ReporterOptions = {},
  ) {
    this.cat = catalogue(cfg);
    this.now = opts.now ?? (() => Date.now());
    this.opts = { maxBatch: 500, queueCap: 100_000, retryMinMs: 1000, retryMaxMs: 30_000, ...opts };
  }

  push(events: SimEvent[]): void {
    if (this.stopped || events.length === 0) return;
    if (this.mapper) for (const e of events) this.out.push(...this.mapper.map(e));
    else this.raw.push(...events);
    this.trim();
  }

  stop(): void {
    this.stopped = true;
    this.raw = [];
    this.out = [];
  }

  status(): ReporterStatus {
    return {
      state: this.state,
      url: this.api.url,
      line: this.cat.line,
      queued: this.raw.length + this.out.length,
      sent: { ...this.sent },
      rejected: this.rejected,
      dropped: this.dropped,
      lastError: this.lastError,
      scopedIdBase: this.keys?.scopedIdBase ?? null,
    };
  }

  /** Does the setup if it hasn't succeeded yet, then sends what's queued. Safe to call often. */
  async tick(maxRequests = 20): Promise<void> {
    if (this.busy || this.stopped || this.now() < this.nextAttempt) return;
    this.busy = true;
    try {
      if (!this.mapper) await this.connect();
      for (let n = 0; n < maxRequests && this.out.length > 0 && !this.stopped; n++) await this.sendNext();
      this.backoff = 0;
      this.state = 'ok';
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof ApiError && !err.transient && this.mapper) {
        // The server refused the request as a whole; retrying won't help. sendNext dropped it.
        this.state = 'ok';
      } else {
        this.state = 'error';
        this.backoff = this.backoff ? Math.min(this.backoff * 2, this.opts.retryMaxMs) : this.opts.retryMinMs;
        this.nextAttempt = this.now() + this.backoff;
      }
    } finally {
      this.busy = false;
    }
  }

  private async connect(): Promise<void> {
    const keys = await setup(this.api, this.cat, this.now());
    const line = this.cat.line;
    // A batch left open by an earlier session is closed where this session's batch starts.
    const active = await this.api.get<NamedPeriod | undefined>(`/api/period/active/${keys.batchTypeId}/${encodeURIComponent(line)}`);
    if (active && active.Name === this.current?.name) {
      this.period = active;
    } else {
      if (active) await this.api.put(`/api/period/${active.Id}`, { ...active, To: new Date(this.current?.startedAt ?? this.now()).toISOString() });
      if (this.current) {
        this.period = await this.api.post<NamedPeriod>('/api/period', {
          TypeId: keys.batchTypeId,
          DeviceId: line,
          Name: this.current.name,
          From: new Date(this.current.startedAt).toISOString(),
        });
      }
    }
    this.keys = keys;
    this.mapper = new Mapper(this.cat, keys);
    const raw = this.raw;
    this.raw = [];
    this.push(raw);
    this.lastError = keys.warnings.length ? keys.warnings.join('; ') : null;
  }

  private async sendNext(): Promise<void> {
    const head = this.out[0];
    if (head.k === 'batch') {
      try {
        await this.batch(head);
      } catch (err) {
        if (err instanceof ApiError && !err.transient) this.out.shift();
        throw err;
      }
      this.out.shift();
      return;
    }
    // The stretch up to the next batch boundary: periods must exist before their items arrive.
    let end = this.out.findIndex((o) => o.k === 'batch');
    if (end < 0) end = this.out.length;
    const kind = ORDER.find((k) => this.out.slice(0, end).some((o) => o.k === k))!;
    const chunk = this.out.slice(0, end).filter((o) => o.k === kind).slice(0, this.opts.maxBatch);
    const payload = chunk.map((o) => (o as Exclude<Outbound, { k: 'batch' }>).v);
    // New events may be pushed while the request is in flight, so sent entries are removed by identity.
    const remove = () => {
      const sent = new Set(chunk);
      this.out = this.out.filter((o) => !sent.has(o));
    };
    let res: BulkResult;
    try {
      res = await this.api.post<BulkResult>(ENDPOINT[kind], payload);
    } catch (err) {
      if (err instanceof ApiError && !err.transient) {
        remove();
        this.rejected += chunk.length;
      }
      throw err;
    }
    remove();
    const ok = res?.Succeeded ?? chunk.length;
    if (kind === 'processed') this.sent.items += ok;
    else if (kind === 'merged') this.sent.merges += ok;
    else this.sent.data += ok;
    if (res?.Failed) {
      this.rejected += res.Failed;
      const first = res.InvalidEntries[0];
      this.lastError = `${kind}: ${res.Failed} of ${res.Total} refused: ${first?.Errors[0]?.Message ?? 'unknown'}`;
    }
  }

  private async batch(op: Extract<Outbound, { k: 'batch' }>): Promise<void> {
    const keys = this.keys!;
    if (op.state === 'started') {
      if (this.period?.Name === op.name) return;
      if (this.period) await this.close(op.at);
      this.period = await this.api.post<NamedPeriod>('/api/period', { TypeId: keys.batchTypeId, DeviceId: this.cat.line, Name: op.name, From: op.at });
    } else if (this.period?.Name === op.name) {
      await this.close(op.at);
    }
  }

  private async close(at: string): Promise<void> {
    const p = this.period!;
    await this.api.put(`/api/period/${p.Id}`, { ...p, To: at });
    this.period = null;
  }

  private trim(): void {
    const over = this.raw.length + this.out.length - this.opts.queueCap;
    if (over <= 0) return;
    // Drop the oldest data but keep batch boundaries so periods stay consistent.
    let n = over;
    this.raw = this.raw.filter((e) => n <= 0 || e.kind === 'batch' || (n--, false));
    this.out = this.out.filter((o) => n <= 0 || o.k === 'batch' || (n--, false));
    this.dropped += over - n;
  }
}
