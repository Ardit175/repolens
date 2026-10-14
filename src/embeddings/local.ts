import type { EmbeddingProvider } from './types.js';

export interface FeatureTensor {
  tolist(): number[][];
}

export type FeaturePipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<FeatureTensor>;

export type PipelineFactory = () => Promise<FeaturePipeline>;

export interface LocalConfig {
  pipelineFactory?: PipelineFactory;
}

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const BATCH_SIZE = 32;

async function loadTransformersPipeline(): Promise<FeaturePipeline> {
  const { pipeline } = await import('@huggingface/transformers');
  return (await pipeline('feature-extraction', MODEL)) as unknown as FeaturePipeline;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly dimensions = 384;

  private readonly factory: PipelineFactory;
  private extractor?: Promise<FeaturePipeline>;

  constructor(config: LocalConfig = {}) {
    this.factory = config.pipelineFactory ?? loadTransformersPipeline;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    this.extractor ??= this.factory();
    const extract = await this.extractor;
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const tensor = await extract(texts.slice(start, start + BATCH_SIZE), {
        pooling: 'mean',
        normalize: true,
      });
      vectors.push(...tensor.tolist());
    }
    return vectors;
  }
}
