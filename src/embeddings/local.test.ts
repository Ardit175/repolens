import { describe, expect, it, vi } from 'vitest';
import { LocalEmbeddingProvider, type FeaturePipeline } from './local.js';

function fakePipeline() {
  const extract = vi.fn<FeaturePipeline>(async (texts) => ({
    tolist: () => texts.map((text) => [text.length, 0]),
  }));
  const factory = vi.fn(async () => extract);
  return { extract, factory };
}

describe('LocalEmbeddingProvider', () => {
  it('exposes name and dimensions', () => {
    const provider = new LocalEmbeddingProvider();
    expect(provider.name).toBe('local');
    expect(provider.dimensions).toBe(384);
  });

  it('returns [] for empty input without loading the model', async () => {
    const { factory } = fakePipeline();
    expect(await new LocalEmbeddingProvider({ pipelineFactory: factory }).embed([])).toEqual([]);
    expect(factory).not.toHaveBeenCalled();
  });

  it('uses mean pooling with normalisation and keeps input order', async () => {
    const { extract, factory } = fakePipeline();
    const provider = new LocalEmbeddingProvider({ pipelineFactory: factory });
    expect(await provider.embed(['a', 'bb'])).toEqual([
      [1, 0],
      [2, 0],
    ]);
    expect(extract).toHaveBeenCalledWith(['a', 'bb'], { pooling: 'mean', normalize: true });
  });

  it('loads the pipeline once and batches large inputs', async () => {
    const { extract, factory } = fakePipeline();
    const provider = new LocalEmbeddingProvider({ pipelineFactory: factory });
    const texts = Array.from({ length: 70 }, (_, i) => 'x'.repeat(i + 1));
    const result = await provider.embed(texts);
    await provider.embed(['a']);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(4);
    expect(result.map((v) => v[0])).toEqual(texts.map((t) => t.length));
  });
});
