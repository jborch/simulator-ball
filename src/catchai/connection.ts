import { CONFIG } from '../config';
import { CatchAiClient } from './client';
import { SendQueue } from './queue';
import { seed } from './seed';
import type { DeviceData } from './types';

export type ConnectionState = 'off' | 'connecting' | 'ok' | 'error';

export interface ConnectionStatus {
  state: ConnectionState;
  url: string | null;
  deviceId: string;
  queued: number;
  dropped: number;
  lastError: string | null;
}

interface StoredCredentials {
  url: string;
  apiKey: string;
}

const cfg = CONFIG.catchAi;

/** Owns credentials, seeding and the send queue; the rest of the app only calls enqueue(). */
export class CatchAiConnection {
  private state: ConnectionState = 'off';
  private client: CatchAiClient | null = null;
  private queue: SendQueue<DeviceData> | null = null;
  private timer: number | undefined;
  private retryTimer: number | undefined;
  private lastError: string | null = null;
  // Guards against a stale connect() finishing after a newer connect/disconnect.
  private generation = 0;

  constructor(private readonly storage: Storage = localStorage) {}

  enqueue = (record: DeviceData): void => {
    this.queue?.push(record);
  };

  connect(apiKey: string, url: string = cfg.defaultUrl): Promise<void> {
    return this.open(apiKey, url, 0);
  }

  private async open(apiKey: string, url: string, retry: number): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this.storage.setItem(cfg.storageKey, JSON.stringify({ url, apiKey } satisfies StoredCredentials));

    const client = new CatchAiClient(url, apiKey);
    this.client = client;
    this.queue = new SendQueue<DeviceData>((batch) => client.postDeviceData(batch), cfg, (ok, err) => {
      if (gen !== this.generation) return;
      this.state = ok ? 'ok' : 'error';
      this.lastError = err ?? null;
    });
    this.state = 'connecting';
    this.lastError = null;

    try {
      await client.version();
      const created = await seed(client, cfg.deviceId, Object.values(cfg.properties), Object.values(cfg.events));
      if (gen !== this.generation) return;
      console.info(`[catchai] connected to ${client.url} as ${cfg.deviceId} (${created} definitions created)`);
      this.state = 'ok';
      const queue = this.queue;
      this.timer = window.setInterval(() => void queue.flush(), cfg.batchIntervalMs);
    } catch (err) {
      if (gen !== this.generation) return;
      this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.queue = null;
      const delay = Math.min(cfg.retryMaxMs, cfg.retryMinMs * 2 ** retry);
      console.error(`[catchai] connect failed: ${this.lastError} (retrying in ${delay / 1000}s)`);
      this.retryTimer = window.setTimeout(() => void this.open(apiKey, url, retry + 1), delay);
    }
  }

  disconnect(): void {
    this.generation++;
    this.stop();
    this.storage.removeItem(cfg.storageKey);
    console.info('[catchai] disconnected');
  }

  /** Reconnects with credentials remembered from a previous session, if any. */
  restore(): void {
    const raw = this.storage.getItem(cfg.storageKey);
    if (!raw) return;
    try {
      const { url, apiKey } = JSON.parse(raw) as StoredCredentials;
      // An empty API key is valid.
      if (typeof apiKey === 'string') void this.connect(apiKey, url);
    } catch {
      this.storage.removeItem(cfg.storageKey);
    }
  }

  status(): ConnectionStatus {
    return {
      state: this.state,
      url: this.client?.url ?? null,
      deviceId: cfg.deviceId,
      queued: this.queue?.length ?? 0,
      dropped: this.queue?.dropped ?? 0,
      lastError: this.lastError,
    };
  }

  private stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.queue = null;
    this.client = null;
    this.state = 'off';
    this.lastError = null;
  }
}
