/**
 * Covers rebuildMemoryIndex's beginUpdate/upsert failure branch (cancelUpdate +
 * rethrow) by mocking vectra so upsertItem throws.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const cancelUpdate = vi.fn();

vi.mock('vectra', () => ({
  LocalIndex: class {
    async isIndexCreated() {
      return true;
    }
    async createIndex() {}
    async listItems() {
      return [];
    }
    async beginUpdate() {}
    endUpdate() {}
    cancelUpdate() {
      cancelUpdate();
    }
    async upsertItem() {
      throw new Error('memory upsert exploded');
    }
    async queryItems() {
      return [];
    }
  },
}));

vi.mock('../src/embeddings.js', () => ({
  embed: async () => [0.1, 0.2, 0.3],
  embedBatch: async (t: string[]) => t.map(() => [0.1, 0.2, 0.3]),
  embedQuery: async () => [0.1, 0.2, 0.3],
}));

const { rebuildMemoryIndex, resetMemoryIndexForTests } = await import('../opencode/search');

let root: string;
let prevRoot: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'macrodata-ocsearch-err-'));
  mkdirSync(join(root, 'journal'), { recursive: true });
  mkdirSync(join(root, '.index'), { recursive: true });
  writeFileSync(
    join(root, 'journal', '2025-01-01.jsonl'),
    JSON.stringify({
      timestamp: '2025-01-01T00:00:00Z',
      topic: 't',
      content: 'will fail to upsert',
    }) + '\n',
  );
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = root;
  resetMemoryIndexForTests();
  cancelUpdate.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('rebuildMemoryIndex upsert failure', () => {
  test('cancels the update and rethrows', async () => {
    await expect(rebuildMemoryIndex()).rejects.toThrow(/memory upsert exploded/);
    expect(cancelUpdate).toHaveBeenCalled();
  });
});
