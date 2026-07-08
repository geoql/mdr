/**
 * Tests for the local (Transformers.js) embedding path.
 *
 * These run the real all-MiniLM-L6-v2 model (downloaded + cached on first use)
 * with no remote provider configured, covering pipeline creation, batching,
 * and preloadModel.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  embed,
  embedBatch,
  embedQuery,
  preloadModel,
  resetEmbeddingConfigCache,
  resetLocalPipelineForTests,
  EMBEDDING_DIMENSIONS,
} from "../src/embeddings";

let prevConfigPath: string | undefined;

beforeEach(() => {
  // Ensure no remote provider is configured so the local model path runs.
  prevConfigPath = process.env.MACRODATA_CONFIG_PATH;
  process.env.MACRODATA_CONFIG_PATH = "/nonexistent/macrodata/config.json";
  resetEmbeddingConfigCache();
});

afterEach(() => {
  if (prevConfigPath === undefined) delete process.env.MACRODATA_CONFIG_PATH;
  else process.env.MACRODATA_CONFIG_PATH = prevConfigPath;
  resetEmbeddingConfigCache();
});

describe("local embeddings", () => {
  test("preloadModel loads the local pipeline", async () => {
    await expect(preloadModel()).resolves.toBeUndefined();
  }, 60000);

  test("embed returns a 384-dim normalized vector", async () => {
    const vector = await embed("hello world");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 2);
  }, 60000);

  test("embedQuery returns a local vector", async () => {
    const vector = await embedQuery("a search query");
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  }, 60000);

  test("embedBatch embeds every input and produces distinct vectors", async () => {
    const vectors = await embedBatch(["cats and dogs", "quantum physics"]);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vectors[0]).not.toEqual(vectors[1]);
  }, 60000);

  test("embedBatch returns [] for empty input", async () => {
    expect(await embedBatch([])).toEqual([]);
  });

  test("concurrent embeds during a cold load share one pipeline promise", async () => {
    resetLocalPipelineForTests();
    // Two embeds fired before the first load resolves: the second must reuse
    // the in-flight pipelineLoading promise.
    const [a, b] = await Promise.all([embed("first"), embed("second")]);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(b).toHaveLength(EMBEDDING_DIMENSIONS);
  }, 60000);
});
