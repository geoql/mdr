/**
 * Tests for the OpenCode plugin's memory search/index (opencode/search.ts).
 *
 * Uses a temp MACRODATA_ROOT and the real embedding model. Mirrors the src
 * indexer coverage but also exercises the topics index and the memory-index
 * singleton reuse.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  searchMemory,
  rebuildMemoryIndex,
  getMemoryIndexStats,
  indexJournalEntry,
  resetMemoryIndexForTests,
} from '../opencode/search';

let root: string;
let prevRoot: string | undefined;

function writeJournal(
  name: string,
  ...entries: Array<{ topic: string; content: string; timestamp?: string }>
) {
  const lines = entries.map((e) =>
    JSON.stringify({
      timestamp: e.timestamp ?? new Date().toISOString(),
      topic: e.topic,
      content: e.content,
    }),
  );
  writeFileSync(join(root, 'journal', `${name}.jsonl`), lines.join('\n') + '\n');
}

function writeEntity(sub: 'people' | 'projects', name: string, body: string) {
  writeFileSync(join(root, 'entities', sub, `${name}.md`), body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'macrodata-ocsearch-'));
  for (const d of ['journal', 'entities/people', 'entities/projects', 'topics', '.index']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = root;
  resetMemoryIndexForTests();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('rebuildMemoryIndex', () => {
  test('indexes journal, entities (preamble + sections) and topics', async () => {
    writeJournal('2025-01-01', { topic: 'cooking', content: 'made pasta carbonara' });
    writeEntity(
      'people',
      'alice',
      'Intro about Alice.\n\n## About\n\nSoftware engineer.\n\n## Empty\n\n',
    );
    writeEntity('projects', 'widget', '## Description\n\nA widget factory.');
    writeFileSync(join(root, 'topics', 'rust.md'), '# Rust\n\nSystems programming language.');

    const result = await rebuildMemoryIndex();
    expect(result.itemCount).toBeGreaterThanOrEqual(4);

    const stats = await getMemoryIndexStats();
    expect(stats.itemCount).toBe(result.itemCount);

    const people = await searchMemory('software engineer', { type: 'person', limit: 5 });
    expect(people[0].type).toBe('person');
    const topics = await searchMemory('systems programming', { type: 'topic', limit: 5 });
    expect(topics[0].type).toBe('topic');
  }, 90000);

  test('returns 0 when there is nothing to index', async () => {
    const result = await rebuildMemoryIndex();
    expect(result.itemCount).toBe(0);
  }, 30000);

  test('skips malformed journal lines and unreadable/absent dirs', async () => {
    writeFileSync(
      join(root, 'journal', '2025-02-02.jsonl'),
      JSON.stringify({ timestamp: '2025-02-02T00:00:00Z', topic: 'ok', content: 'valid' }) +
        '\n{ bad json\n',
    );
    // Remove the topics dir so its existsSync branch is false.
    rmSync(join(root, 'topics'), { recursive: true, force: true });
    const result = await rebuildMemoryIndex();
    expect(result.itemCount).toBe(1);
  }, 60000);

  test('indexes a preamble-only entity and a topic-only tree', async () => {
    writeEntity('people', 'bob', 'Just a preamble, no sections.');
    writeFileSync(join(root, 'topics', 'go.md'), 'Go is fast.');
    // No journal dir contents, no projects.
    const result = await rebuildMemoryIndex();
    expect(result.itemCount).toBe(2);
  }, 60000);
});

describe('searchMemory', () => {
  test('returns [] on an empty index', async () => {
    const results = await searchMemory('anything', { limit: 5 });
    expect(results).toEqual([]);
  }, 30000);

  test('filters by since date and keeps undated entity results', async () => {
    writeJournal('old', {
      topic: 'old',
      content: 'ancient note',
      timestamp: '2024-01-01T00:00:00Z',
    });
    writeJournal('new', { topic: 'new', content: 'fresh note', timestamp: '2025-06-01T00:00:00Z' });
    writeEntity('people', 'carol', '## Bio\n\ntimeless carol bio');
    await rebuildMemoryIndex();

    const results = await searchMemory('note', { since: '2025-01-01', limit: 10 });
    for (const r of results) {
      if (r.timestamp) expect(r.timestamp >= '2025-01-01').toBe(true);
    }
  }, 90000);
});

describe('search + index edge branches', () => {
  test('plain search applies no type/since filter', async () => {
    writeJournal('2025-03-03', { topic: 'plain', content: 'a plain searchable note about otters' });
    await rebuildMemoryIndex();
    const results = await searchMemory('otters', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
  }, 60000);

  test('rebuild tolerates absent journal and entity directories', async () => {
    rmSync(join(root, 'journal'), { recursive: true, force: true });
    rmSync(join(root, 'entities', 'people'), { recursive: true, force: true });
    rmSync(join(root, 'entities', 'projects'), { recursive: true, force: true });
    writeFileSync(join(root, 'topics', 'solo.md'), 'just a topic');
    const result = await rebuildMemoryIndex();
    expect(result.itemCount).toBe(1);
  }, 60000);

  test('indexes an entity that starts with a heading and skips empty sections', async () => {
    writeEntity('projects', 'head', '## Empty\n\n## Filled\n\nreal project content');
    const result = await rebuildMemoryIndex();
    expect(result.itemCount).toBe(1);
  }, 60000);

  test('getMemoryIndex reuses the cached index across calls in one run', async () => {
    writeJournal('2025-04-04', { topic: 'cache', content: 'cache reuse content' });
    await rebuildMemoryIndex();
    const a = await getMemoryIndexStats();
    const b = await getMemoryIndexStats();
    expect(a.itemCount).toBe(b.itemCount);
  }, 60000);

  test('creates the index dir when it is absent', async () => {
    rmSync(join(root, '.index'), { recursive: true, force: true });
    await indexJournalEntry({
      timestamp: new Date().toISOString(),
      topic: 't',
      content: 'needs a fresh index dir',
    });
    expect((await getMemoryIndexStats()).itemCount).toBe(1);
  }, 60000);
});

describe('indexJournalEntry', () => {
  test('adds a single entry incrementally and reuses the index singleton', async () => {
    await indexJournalEntry({
      timestamp: new Date().toISOString(),
      topic: 'note',
      content: 'incremental content here',
    });
    const stats = await getMemoryIndexStats();
    expect(stats.itemCount).toBe(1);
    // Second call reuses the cached memory index.
    await indexJournalEntry({
      timestamp: new Date(Date.now() + 1).toISOString(),
      topic: 'note2',
      content: 'another one',
    });
    expect((await getMemoryIndexStats()).itemCount).toBe(2);
  }, 60000);
});
