/**
 * Covers getRemoteEmbeddingConfig's default config-path branch (no
 * MACRODATA_CONFIG_PATH set) with os.homedir redirected to a temp dir.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeHome = mkdtempSync(join(tmpdir(), "macrodata-embed-home-"));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => fakeHome };
});

const { getRemoteEmbeddingConfig, resetEmbeddingConfigCache } = await import("../src/embeddings");

let prev: string | undefined;

beforeEach(() => {
  prev = process.env.MACRODATA_CONFIG_PATH;
  delete process.env.MACRODATA_CONFIG_PATH;
  resetEmbeddingConfigCache();
});

afterEach(() => {
  if (prev === undefined) delete process.env.MACRODATA_CONFIG_PATH;
  else process.env.MACRODATA_CONFIG_PATH = prev;
  resetEmbeddingConfigCache();
});

describe("getRemoteEmbeddingConfig default path", () => {
  test("returns null when the default config.json is absent", () => {
    expect(getRemoteEmbeddingConfig()).toBeNull();
  });
});
