export class RetryableError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { retries = 3, baseDelayMs = 500, sleep = defaultSleep } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RetryableError) || attempt >= retries) throw error;
      await sleep(error.retryAfterMs ?? baseDelayMs * 2 ** attempt);
    }
  }
}

/**
 * Embeds texts in sequential batches. A batch that fails with a RetryableError is retried
 * with exponential backoff (or the server's Retry-After); any other error is thrown at once.
 */
export async function embedInBatches(
  texts: string[],
  batchSize: number,
  fn: (batch: string[]) => Promise<number[][]>,
  retry: RetryOptions = {},
): Promise<number[][]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batchSize must be a positive integer, got ${batchSize}`);
  }
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    const result = await withRetry(() => fn(batch), retry);
    if (result.length !== batch.length) {
      throw new Error(
        `Embedding batch returned ${result.length} vectors for ${batch.length} texts`,
      );
    }
    vectors.push(...result);
  }
  return vectors;
}
