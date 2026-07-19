/**
 * Tests for the OpenCode conversation index retention cap and protobuf codec
 * (#27): the JSON index grew past V8's 0x1fffffe8 max-string length and both
 * the read and write paths died. The fix caps the index at
 * MAX_CONVERSATION_ITEMS newest exchanges (FIFO eviction) and stores the index
 * with vectra's ProtobufCodec (index.pb, ~50% smaller than JSON).
 *
 * MACRODATA_ROOT is pointed at temp dirs; the pure/eviction helpers are
 * exercised against a real vectra LocalIndex with tiny hand-made vectors so no
 * embedding model is needed.
 */

import { describe, test, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalIndex } from 'vectra';

const roots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

process.env.MACRODATA_ROOT = makeRoot('macrodata-retention-');

const oc = await import('../opencode/conversations');

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeExchange(n: number): import('../opencode/conversations').ConversationExchange {
  return {
    id: `oc-ses-${n}`,
    userPrompt: `prompt ${n}`,
    assistantSummary: `summary ${n}`,
    project: 'proj',
    projectPath: '/tmp/proj',
    timestamp: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    sessionId: `ses-${n}`,
    messageId: `msg-${n}`,
  };
}

describe('MAX_CONVERSATION_ITEMS', () => {
  test('is 22000 (~220 MB protobuf, safely under the 536 MB V8 string cap)', () => {
    expect(oc.MAX_CONVERSATION_ITEMS).toBe(22000);
  });
});

describe('capExchanges', () => {
  test('keeps only the newest `cap` exchanges, preserving order', () => {
    const exchanges = [1, 2, 3, 4, 5, 6, 7, 8].map(makeExchange);
    const capped = oc.capExchanges(exchanges, 5);
    expect(capped).toHaveLength(5);
    expect(capped.map((e) => e.id)).toEqual([
      'oc-ses-4',
      'oc-ses-5',
      'oc-ses-6',
      'oc-ses-7',
      'oc-ses-8',
    ]);
  });

  test('returns the input unchanged when at or under the cap', () => {
    const exchanges = [1, 2, 3].map(makeExchange);
    expect(oc.capExchanges(exchanges, 5)).toBe(exchanges);
    expect(oc.capExchanges(exchanges, 3)).toBe(exchanges);
  });
});

describe('enforceRetentionCap', () => {
  async function makeIndex(items: number): Promise<LocalIndex> {
    const dir = join(makeRoot('macrodata-evict-'), 'idx');
    const idx = new LocalIndex(dir);
    await idx.createIndex();
    for (let n = 1; n <= items; n++) {
      await idx.insertItem({
        id: `oc-ses-${n}`,
        vector: [n * 0.1, 0.2, 0.3],
        metadata: { messageId: `msg-${n}` },
      });
    }
    return idx;
  }

  test('evicts the oldest items so count lands exactly on the cap', async () => {
    const idx = await makeIndex(8);
    const existing = await idx.listItems();

    await idx.beginUpdate();
    const evicted = await oc.enforceRetentionCap(idx, existing, 0, 5);
    await idx.endUpdate();

    expect(evicted).toBe(3);
    const remaining = await idx.listItems();
    expect(remaining).toHaveLength(5);
    expect(remaining.map((i) => i.id)).toEqual([
      'oc-ses-4',
      'oc-ses-5',
      'oc-ses-6',
      'oc-ses-7',
      'oc-ses-8',
    ]);
  });

  test('accounts for incoming items when computing the overflow', async () => {
    // 6 existing + 2 incoming against a cap of 5 → evict the 3 oldest.
    const idx = await makeIndex(6);
    const existing = await idx.listItems();

    await idx.beginUpdate();
    const evicted = await oc.enforceRetentionCap(idx, existing, 2, 5);
    await idx.endUpdate();

    expect(evicted).toBe(3);
    const remaining = await idx.listItems();
    expect(remaining.map((i) => i.id)).toEqual(['oc-ses-4', 'oc-ses-5', 'oc-ses-6']);
  });

  test('is a no-op when existing plus incoming fit under the cap', async () => {
    const idx = await makeIndex(3);
    const existing = await idx.listItems();

    await idx.beginUpdate();
    const evicted = await oc.enforceRetentionCap(idx, existing, 1, 5);
    await idx.endUpdate();

    expect(evicted).toBe(0);
    expect(await idx.listItems()).toHaveLength(3);
  });
});

describe('protobuf conversation index (#27)', () => {
  test('creates the index as index.pb, not index.json', async () => {
    process.env.MACRODATA_ROOT = makeRoot('macrodata-pb-');
    oc.resetConversationIndexForTests();

    const stats = await oc.getConversationIndexStats();
    expect(stats.exchangeCount).toBe(0);

    const indexDir = join(process.env.MACRODATA_ROOT, '.index', 'oc-conversations');
    expect(existsSync(join(indexDir, 'index.pb'))).toBe(true);
    expect(existsSync(join(indexDir, 'index.json'))).toBe(false);
  });

  test('deletes an orphaned legacy index.json left by the JSON codec', async () => {
    const root = makeRoot('macrodata-legacy-');
    const indexDir = join(root, '.index', 'oc-conversations');
    mkdirSync(indexDir, { recursive: true });
    // Stand-in for the unreadable >536 MB JSON index from #27.
    writeFileSync(join(indexDir, 'index.json'), '{"version":1,"items":[]}');

    process.env.MACRODATA_ROOT = root;
    oc.resetConversationIndexForTests();

    await oc.getConversationIndexStats();
    expect(existsSync(join(indexDir, 'index.json'))).toBe(false);
    expect(existsSync(join(indexDir, 'index.pb'))).toBe(true);
  });
});
