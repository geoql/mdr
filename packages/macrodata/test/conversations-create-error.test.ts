/**
 * Covers the createIndex failure branch in getConversationIndex: a failed
 * creation must reset the module-level index cache so the next call retries
 * instead of reusing a dead instance pointing at a stale path (#31).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const fakeHome = mkdtempSync(join(tmpdir(), 'macrodata-cc-create-home-'));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

const createIndexMock = vi.fn();

vi.mock('vectra', () => ({
  LocalIndex: class {
    async isIndexCreated() {
      return false;
    }
    async createIndex() {
      createIndexMock();
      throw new Error('Error creating index');
    }
    async listItems() {
      return [];
    }
  },
}));

vi.mock('../src/embeddings.js', () => ({
  embedBatch: async (t: string[]) => t.map(() => [0.1, 0.2, 0.3]),
  embedQuery: async () => [0.1, 0.2, 0.3],
  preloadModel: async () => {},
}));

const conversations = await import('../src/conversations');

let stateRoot: string;
let prevRoot: string | undefined;

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), 'macrodata-cc-create-state-'));
  mkdirSync(join(stateRoot, '.index'), { recursive: true });
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = stateRoot;
  createIndexMock.mockClear();
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('createIndex failure handling', () => {
  test('a failed index creation is not cached: the next call retries', async () => {
    await expect(conversations.getConversationIndexStats()).rejects.toThrow(/Error creating index/);
    await expect(conversations.getConversationIndexStats()).rejects.toThrow(/Error creating index/);
    expect(createIndexMock).toHaveBeenCalledTimes(2);
  });
});
