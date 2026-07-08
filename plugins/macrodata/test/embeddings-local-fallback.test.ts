/**
 * Covers embedLocal's dimension fallback (used when a pipeline output omits
 * its dims) by mocking the transformers pipeline at the import boundary.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@huggingface/transformers", () => ({
  pipeline: async () => {
    return (batch: string[]) => ({
      // No dims field → embedLocal must fall back to EMBEDDING_DIMENSIONS.
      dims: undefined,
      data: new Float32Array(batch.length * 384).fill(0.5),
    });
  },
}));

const { embed, EMBEDDING_DIMENSIONS, resetEmbeddingConfigCache, resetLocalPipelineForTests } =
  await import("../src/embeddings");

let prev: string | undefined;

beforeEach(() => {
  prev = process.env.MACRODATA_CONFIG_PATH;
  process.env.MACRODATA_CONFIG_PATH = "/nonexistent/config.json";
  resetEmbeddingConfigCache();
  resetLocalPipelineForTests();
});

afterEach(() => {
  if (prev === undefined) delete process.env.MACRODATA_CONFIG_PATH;
  else process.env.MACRODATA_CONFIG_PATH = prev;
  resetEmbeddingConfigCache();
  resetLocalPipelineForTests();
});

describe("embedLocal dimension fallback", () => {
  test("uses EMBEDDING_DIMENSIONS when the pipeline output has no dims", async () => {
    const vector = await embed("anything");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});
