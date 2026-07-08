/**
 * Tests for opencode/journal.ts (logJournal, getRecentJournal,
 * getRecentSummaries, saveConversationSummary) against a temp MACRODATA_ROOT
 * with the real embedding model behind indexJournalEntry.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  logJournal,
  getRecentJournal,
  getRecentSummaries,
  saveConversationSummary,
} from '../opencode/journal';
import { resetMemoryIndexForTests } from '../opencode/search';

let root: string;
let prevRoot: string | undefined;

function journalFileForToday(): string {
  const today = new Date().toISOString().split('T')[0];
  return join(root, 'journal', `${today}.jsonl`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'macrodata-ocjournal-'));
  mkdirSync(join(root, '.index'), { recursive: true });
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = root;
  resetMemoryIndexForTests();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('logJournal', () => {
  test('bootstraps directories, writes the entry, and indexes it', async () => {
    await logJournal('testing', 'wrote a journal test', { source: 'unit', intent: 'coverage' });
    expect(existsSync(join(root, 'entities', 'people'))).toBe(true);

    const entry = JSON.parse(readFileSync(journalFileForToday(), 'utf-8').trim());
    expect(entry.topic).toBe('testing');
    expect(entry.metadata).toEqual({ source: 'unit', intent: 'coverage' });
  }, 60000);

  test('defaults metadata when none is provided', async () => {
    await logJournal('nometa', 'entry without metadata');
    const entry = JSON.parse(readFileSync(journalFileForToday(), 'utf-8').trim());
    expect(entry.metadata).toEqual({ source: 'opencode-plugin' });
  }, 60000);

  test('still writes the entry when indexing fails', async () => {
    // A file at the .index path makes the indexer's mkdir/create throw; the
    // logJournal catch must swallow it so the entry is still persisted.
    rmSync(join(root, '.index'), { recursive: true, force: true });
    writeFileSync(join(root, '.index'), 'not a directory');
    await logJournal('resilient', 'entry that survives an index failure');
    const entry = JSON.parse(readFileSync(journalFileForToday(), 'utf-8').trim());
    expect(entry.topic).toBe('resilient');
  }, 60000);
});

describe('getRecentJournal', () => {
  test('returns [] when the journal dir is absent', () => {
    rmSync(join(root, 'journal'), { recursive: true, force: true });
    expect(getRecentJournal(5)).toEqual([]);
  });

  test('reads recent entries across files, newest first, filtered by topic', () => {
    mkdirSync(join(root, 'journal'), { recursive: true });
    writeFileSync(
      join(root, 'journal', '2025-01-01.jsonl'),
      [
        JSON.stringify({ timestamp: '2025-01-01T01:00:00Z', topic: 'a', content: 'one' }),
        JSON.stringify({ timestamp: '2025-01-01T02:00:00Z', topic: 'b', content: 'two' }),
      ].join('\n') + '\n',
    );
    writeFileSync(
      join(root, 'journal', '2025-01-02.jsonl'),
      JSON.stringify({ timestamp: '2025-01-02T01:00:00Z', topic: 'a', content: 'three' }) + '\n',
    );

    const all = getRecentJournal(10);
    expect(all.length).toBe(3);

    const onlyA = getRecentJournal(10, 'a');
    expect(onlyA.every((e) => e.topic === 'a')).toBe(true);
    expect(onlyA.length).toBe(2);
  });

  test('skips malformed lines and stops at the count*2 file cap', () => {
    mkdirSync(join(root, 'journal'), { recursive: true });
    for (let d = 1; d <= 6; d++) {
      const day = String(d).padStart(2, '0');
      writeFileSync(
        join(root, 'journal', `2025-01-${day}.jsonl`),
        JSON.stringify({
          timestamp: `2025-01-${day}T00:00:00Z`,
          topic: 't',
          content: `entry ${d}`,
        }) + '\n{ bad\n',
      );
    }
    const result = getRecentJournal(2);
    expect(result.length).toBe(2);
  });
});

describe('getRecentSummaries + saveConversationSummary', () => {
  test('saves a summary with all fields and reads it back', async () => {
    await saveConversationSummary({
      summary: 'did the thing',
      keyDecisions: ['chose vitest'],
      openThreads: ['coverage'],
      learnedPatterns: ['likes tests'],
      notes: 'all green',
    });
    const summaries = getRecentSummaries(5);
    expect(summaries.length).toBe(1);
    expect(summaries[0].content).toContain('did the thing');
    expect(summaries[0].content).toContain('Decisions: chose vitest');
    expect(summaries[0].content).toContain('Open threads: coverage');
    expect(summaries[0].content).toContain('Learned: likes tests');
    expect(summaries[0].content).toContain('Notes: all green');
  }, 60000);

  test('saves a summary with only the required field', async () => {
    await saveConversationSummary({ summary: 'just a summary' });
    const summaries = getRecentSummaries(5);
    expect(summaries[0].content).toBe('just a summary');
  }, 60000);
});
