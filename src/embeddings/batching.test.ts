import { describe, expect, it, vi } from 'vitest';
import { embedInBatches, RetryableError } from './batching.js';

const echo = async (batch: string[]) => batch.map((text) => [text.length]);

describe('embedInBatches', () => {
  it('returns [] for empty input without calling fn', async () => {
    const fn = vi.fn(echo);
    expect(await embedInBatches([], 4, fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('splits into batches and keeps input order', async () => {
    const fn = vi.fn(echo);
    const result = await embedInBatches(['a', 'bb', 'ccc', 'dddd', 'eeeee'], 2, fn);
    expect(fn.mock.calls.map(([batch]) => batch)).toEqual([
      ['a', 'bb'],
      ['ccc', 'dddd'],
      ['eeeee'],
    ]);
    expect(result).toEqual([[1], [2], [3], [4], [5]]);
  });

  it('retries retryable errors with exponential backoff, then succeeds', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    let calls = 0;
    const fn = async (batch: string[]) => {
      if (++calls < 3) throw new RetryableError('busy');
      return echo(batch);
    };
    expect(await embedInBatches(['a'], 1, fn, { sleep })).toEqual([[1]]);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('honours a custom base delay and retryAfterMs', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    let calls = 0;
    const fn = async (batch: string[]) => {
      if (++calls === 1) throw new RetryableError('slow down', 2000);
      if (calls === 2) throw new RetryableError('again');
      return echo(batch);
    };
    await embedInBatches(['a'], 1, fn, { sleep, baseDelayMs: 10 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 20]);
  });

  it('throws the last error after the retries are exhausted', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fn = vi.fn(async () => {
      throw new RetryableError('still busy');
    });
    await expect(embedInBatches(['a'], 1, fn, { sleep })).rejects.toThrow('still busy');
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('throws non-retryable errors immediately', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const fn = vi.fn(async () => {
      throw new Error('bad request');
    });
    await expect(embedInBatches(['a'], 1, fn, { sleep })).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('rejects an invalid batch size and a mismatched result length', async () => {
    await expect(embedInBatches(['a'], 0, echo)).rejects.toThrow('batchSize');
    await expect(embedInBatches(['a', 'b'], 2, async () => [[1]])).rejects.toThrow(
      'returned 1 vectors for 2 texts',
    );
  });

  it('uses the real timer by default', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const promise = embedInBatches(['a'], 1, async (batch) => {
        if (++calls === 1) throw new RetryableError('busy');
        return echo(batch);
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(await promise).toEqual([[1]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
