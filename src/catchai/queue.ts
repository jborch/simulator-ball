export interface QueueOptions {
  maxBatchSize: number;
  queueCap: number;
  retryMinMs: number;
  retryMaxMs: number;
}

export type QueueListener = (ok: boolean, error?: string) => void;

/** Buffers items and sends them in batches; a failed batch stays queued and is retried with exponential backoff. */
export class SendQueue<T> {
  private items: T[] = [];
  private sending = false;
  private backoff = 0;
  private nextAttempt = 0;
  dropped = 0;
  lastError: string | null = null;

  constructor(
    private readonly send: (batch: T[]) => Promise<void>,
    private readonly opts: QueueOptions,
    private readonly listener?: QueueListener,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get length(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    const over = this.items.length - this.opts.queueCap;
    if (over > 0) {
      this.items.splice(0, over);
      this.dropped += over;
    }
  }

  async flush(): Promise<void> {
    if (this.sending || this.items.length === 0 || this.now() < this.nextAttempt) return;
    this.sending = true;
    const batch = this.items.slice(0, this.opts.maxBatchSize);
    const droppedBefore = this.dropped;
    try {
      await this.send(batch);
      // Items trimmed by the cap during the send were part of this batch's head.
      this.items.splice(0, Math.max(0, batch.length - (this.dropped - droppedBefore)));
      this.backoff = 0;
      this.nextAttempt = 0;
      this.lastError = null;
      this.listener?.(true);
    } catch (err) {
      this.backoff = this.backoff ? Math.min(this.backoff * 2, this.opts.retryMaxMs) : this.opts.retryMinMs;
      this.nextAttempt = this.now() + this.backoff;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.listener?.(false, this.lastError);
    } finally {
      this.sending = false;
    }
  }
}
