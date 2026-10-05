import { CONFIG } from './config';

export type TimeSyncState = 'off' | 'pending' | 'synced' | 'error';

export interface TimeSyncStatus {
  state: TimeSyncState;
  url: string | null;
  /** Server clock minus local clock. */
  offsetMs: number | null;
  rttMs: number | null;
  lastSync: string | null;
  lastError: string | null;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const cfg = CONFIG.timeSync;

/** Parses a .NET DateTime JSON string (up to 7 fractional digits, zone optional = UTC) to epoch ms. */
export function parseUtc(s: string): number {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(s);
  const base = m ? Date.parse(m[1] + (m[3] ?? 'Z')) : NaN;
  if (!m || Number.isNaN(base)) throw new Error(`invalid time: ${s}`);
  return base + (m[2] ? Number(m[2]) * 1000 : 0);
}

/** Wall clock that follows a server's /api/time when connected, and the local clock otherwise. */
export class TimeSync {
  private url: string | null = null;
  // Server epoch ms minus perfNow(); based on the monotonic clock so local clock jumps don't matter.
  private offset: number | null = null;
  private rtt: number | null = null;
  private lastSync: number | null = null;
  private lastError: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(
    private readonly storage: Storage = localStorage,
    private readonly fetchFn: Fetch = (u, i) => fetch(u, i),
    private readonly perfNow: () => number = () => performance.now(),
  ) {}

  now(): number {
    return this.offset === null ? Date.now() : this.perfNow() + this.offset;
  }

  date(): Date {
    return new Date(this.now());
  }

  get state(): TimeSyncState {
    if (!this.url) return 'off';
    if (this.lastError) return 'error';
    return this.offset === null ? 'pending' : 'synced';
  }

  connect(url: string): Promise<void> {
    this.reset();
    this.storage.setItem(cfg.storageKey, url);
    this.url = url;
    return this.loop(this.generation);
  }

  disconnect(): void {
    this.reset();
    this.storage.removeItem(cfg.storageKey);
    console.info('[timesync] disconnected, using local clock');
  }

  restore(): void {
    const url = this.storage.getItem(cfg.storageKey);
    if (url) void this.connect(url);
  }

  status(): TimeSyncStatus {
    return {
      state: this.state,
      url: this.url,
      offsetMs: this.offset === null ? null : this.now() - Date.now(),
      rttMs: this.rtt,
      lastSync: this.lastSync === null ? null : new Date(this.lastSync).toISOString(),
      lastError: this.lastError,
    };
  }

  /** Takes several samples and keeps the offset from the one with the shortest round trip. */
  async sync(): Promise<boolean> {
    const url = this.url;
    const gen = this.generation;
    if (!url) return false;
    let best: { offset: number; rtt: number } | null = null;
    let error: string | null = null;

    for (let i = 0; i < cfg.samples; i++) {
      try {
        const t0 = this.perfNow();
        const res = await this.fetchFn(url, { cache: 'no-store', signal: AbortSignal.timeout(cfg.requestTimeoutMs) });
        const t1 = this.perfNow();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { utc?: unknown; Utc?: unknown };
        const raw = body.utc ?? body.Utc;
        if (typeof raw !== 'string') throw new Error('response has no utc field');
        const rtt = t1 - t0;
        // Assume the server stamped the time halfway through the round trip.
        if (!best || rtt < best.rtt) best = { offset: parseUtc(raw) + rtt / 2 - t1, rtt };
      } catch (err) {
        error ??= err instanceof Error ? err.message : String(err);
      }
    }

    if (gen !== this.generation) return false;
    if (best) {
      // On failure the previous offset is kept: a slightly stale offset beats jumping to the local clock.
      this.offset = best.offset;
      this.rtt = best.rtt;
      this.lastError = null;
      this.lastSync = this.now();
      console.debug(`[timesync] offset=${this.status().offsetMs?.toFixed(1)}ms rtt=${best.rtt.toFixed(1)}ms`);
    } else {
      this.lastError = error;
      console.error(`[timesync] sync with ${url} failed: ${error}`);
    }
    return best !== null;
  }

  private async loop(gen: number): Promise<void> {
    const ok = await this.sync();
    if (gen !== this.generation) return;
    this.timer = setTimeout(() => void this.loop(gen), ok ? cfg.resyncMs : cfg.retryMs);
  }

  private reset(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.url = null;
    this.offset = null;
    this.rtt = null;
    this.lastSync = null;
    this.lastError = null;
  }
}

declare global {
  interface Window {
    timesync: Pick<TimeSync, 'connect' | 'disconnect' | 'status' | 'sync'>;
  }
}

export function installTimeSyncConsole(ts: TimeSync): void {
  window.timesync = {
    connect: (url) => ts.connect(url),
    disconnect: () => ts.disconnect(),
    status: () => ts.status(),
    sync: () => ts.sync(),
  };
}
