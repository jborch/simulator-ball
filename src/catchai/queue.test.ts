import { describe, expect, it } from 'vitest';
import { SendQueue } from './queue';

const opts = { maxBatchSize: 3, queueCap: 5, retryMinMs: 1000, retryMaxMs: 4000 };

describe('SendQueue', () => {
  it('sends in batches of maxBatchSize and removes sent items', async () => {
    const sent: number[][] = [];
    const q = new SendQueue<number>(async (b) => void sent.push(b), opts);
    [1, 2, 3, 4].forEach((n) => q.push(n));
    await q.flush();
    await q.flush();
    expect(sent).toEqual([[1, 2, 3], [4]]);
    expect(q.length).toBe(0);
  });

  it('keeps a failed batch and retries with exponential backoff', async () => {
    let t = 0;
    let fail = true;
    const sent: number[][] = [];
    const q = new SendQueue<number>(
      async (b) => {
        if (fail) throw new Error('down');
        sent.push(b);
      },
      opts,
      undefined,
      () => t,
    );
    q.push(1);
    await q.flush();
    expect(q.lastError).toBe('down');
    expect(q.length).toBe(1);

    t = 500;
    await q.flush(); // still backing off
    t = 1000;
    await q.flush(); // fails again → backoff 2000
    t = 2999;
    await q.flush();
    expect(sent).toEqual([]);

    fail = false;
    t = 3000;
    await q.flush();
    expect(sent).toEqual([[1]]);
    expect(q.lastError).toBeNull();
  });

  it('drops the oldest items when over the cap', () => {
    const q = new SendQueue<number>(async () => {}, opts);
    [1, 2, 3, 4, 5, 6, 7].forEach((n) => q.push(n));
    expect(q.length).toBe(5);
    expect(q.dropped).toBe(2);
  });
});
