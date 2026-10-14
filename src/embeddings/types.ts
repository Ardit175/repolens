export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  /** Returns one vector per input text, in input order. An empty input returns []. */
  embed(texts: string[]): Promise<number[][]>;
}
