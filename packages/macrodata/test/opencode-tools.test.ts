/**
 * Tests for the OpenCode memory tools (opencode/tools.ts). Every tool's execute
 * is invoked directly against a temp MACRODATA_ROOT with the real embedding
 * model, covering both the validation-error and success branches.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { memoryTools } from '~~/opencode/tools';
import { resetMemoryIndexForTests } from '~~/opencode/search';
import { resetConversationIndexForTests } from '~~/opencode/conversations';

let root: string;
let prevRoot: string | undefined;

// The tool `execute` signatures accept a second context arg we do not use.
type Exec = (args: Record<string, unknown>) => Promise<string>;
function run(name: keyof typeof memoryTools, args: Record<string, unknown> = {}): Promise<string> {
  return (memoryTools[name].execute as unknown as Exec)(args);
}
async function json(name: keyof typeof memoryTools, args: Record<string, unknown> = {}) {
  return JSON.parse(await run(name, args));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'macrodata-octools-'));
  mkdirSync(join(root, '.index'), { recursive: true });
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = root;
  resetMemoryIndexForTests();
  resetConversationIndexForTests();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('registration', () => {
  test('exposes all 13 tools', () => {
    expect(Object.keys(memoryTools)).toHaveLength(13);
  });
});

describe('journal tools', () => {
  test('log_journal validates and writes', async () => {
    expect((await json('macrodata_log_journal', { topic: '' })).success).toBe(false);
    expect((await json('macrodata_log_journal', { topic: 't', content: '' })).success).toBe(false);
    const ok = await json('macrodata_log_journal', {
      topic: 't',
      content: 'c',
      agentIntent: 'why',
    });
    expect(ok.success).toBe(true);
    expect(ok.message).toContain('Logged to journal: t');
  }, 60000);

  test('get_recent_journal returns entries with defaults', async () => {
    await run('macrodata_log_journal', { topic: 'a', content: 'one' });
    const withCount = await json('macrodata_get_recent_journal', { count: 5 });
    expect(withCount.success).toBe(true);
    const withDefault = await json('macrodata_get_recent_journal');
    expect(Array.isArray(withDefault.entries)).toBe(true);
  }, 60000);
});

describe('summary tools', () => {
  test('save_conversation_summary validates and saves', async () => {
    expect((await json('macrodata_save_conversation_summary', {})).success).toBe(false);
    const ok = await json('macrodata_save_conversation_summary', {
      summary: 's',
      keyDecisions: ['d'],
    });
    expect(ok.success).toBe(true);
  }, 60000);

  test('get_recent_summaries returns with default and custom count', async () => {
    await run('macrodata_save_conversation_summary', { summary: 's1' });
    expect((await json('macrodata_get_recent_summaries', { count: 3 })).success).toBe(true);
    expect((await json('macrodata_get_recent_summaries')).success).toBe(true);
  }, 60000);
});

describe('search tools', () => {
  test('search_memory validates, reports no matches, then returns ranked results', async () => {
    expect((await json('macrodata_search_memory', {})).success).toBe(false);

    const empty = await json('macrodata_search_memory', { query: 'nothing' });
    expect(empty.results).toEqual([]);
    expect(empty.message).toContain('No matches');

    await run('macrodata_log_journal', { topic: 'cook', content: 'carbonara with fresh eggs' });
    resetMemoryIndexForTests();
    await run('macrodata_rebuild_memory_index');
    const hit = await json('macrodata_search_memory', {
      query: 'italian pasta',
      type: 'journal',
      limit: 3,
    });
    expect(hit.count).toBeGreaterThan(0);
    expect(hit.results[0].content).toContain('carbonara');
  }, 90000);

  test('search_conversations validates and reports no matches on an empty index', async () => {
    expect((await json('macrodata_search_conversations', {})).success).toBe(false);
    const empty = await json('macrodata_search_conversations', {
      query: 'anything',
      projectOnly: true,
    });
    expect(empty.results).toEqual([]);
  }, 60000);

  test('search_conversations formats results from a seeded index', async () => {
    const { LocalIndex, ProtobufCodec } = await import('vectra');
    const { embed } = await import('../src/embeddings');
    const idx = new LocalIndex(
      join(root, '.index', 'oc-conversations'),
      undefined,
      undefined,
      new ProtobufCodec(),
    );
    await idx.createIndex();
    await idx.upsertItem({
      id: 'oc-seed',
      vector: await embed('deploying workers on cloudflare'),
      metadata: {
        userPrompt: 'how to deploy a worker',
        assistantSummary: 'use wrangler',
        project: 'maps',
        projectPath: process.cwd(),
        timestamp: new Date().toISOString(),
        sessionId: 's1',
        messageId: 'm1',
      },
    });
    const out = await json('macrodata_search_conversations', { query: 'cloudflare worker deploy' });
    expect(out.count).toBeGreaterThan(0);
    expect(out.results[0].project).toBe('maps');
    expect(out.results[0].userPrompt).toBe('how to deploy a worker');
  }, 90000);
});

describe('index tools', () => {
  test('rebuild_memory_index returns memory stats', async () => {
    await run('macrodata_log_journal', { topic: 't', content: 'indexed content' });
    resetMemoryIndexForTests();
    const out = await json('macrodata_rebuild_memory_index');
    expect(out.success).toBe(true);
    expect(out.stats.memoryItems).toBeGreaterThan(0);
  }, 90000);

  test('get_memory_index_stats returns both counts', async () => {
    const out = await json('macrodata_get_memory_index_stats');
    expect(out.success).toBe(true);
    expect(typeof out.memoryItems).toBe('number');
    expect(typeof out.conversationExchanges).toBe('number');
  }, 60000);
});

describe('reminder tools', () => {
  test('schedule_reminder validates and creates with/without a model', async () => {
    expect((await json('macrodata_schedule_reminder', { id: 'x' })).success).toBe(false);
    const withModel = await json('macrodata_schedule_reminder', {
      id: 'daily',
      cronExpression: '0 9 * * *',
      description: 'morning',
      payload: 'check in',
      model: 'prov/model',
    });
    expect(withModel.message).toContain('with model prov/model');
    expect(existsSync(join(root, 'reminders', 'daily.json'))).toBe(true);

    const noModel = await json('macrodata_schedule_reminder', {
      id: 'd2',
      cronExpression: '0 8 * * *',
      description: 'd',
      payload: 'p',
    });
    expect(noModel.message).not.toContain('with model');
  });

  test('schedule_once validates and creates with/without a model', async () => {
    expect((await json('macrodata_schedule_once', { id: 'x' })).success).toBe(false);
    const withModel = await json('macrodata_schedule_once', {
      id: 'once1',
      datetime: '2099-01-01T00:00:00Z',
      description: 'd',
      payload: 'p',
      model: 'm',
    });
    expect(withModel.message).toContain('with model m');
    const noModel = await json('macrodata_schedule_once', {
      id: 'once2',
      datetime: '2099-01-02T00:00:00Z',
      description: 'd',
      payload: 'p',
    });
    expect(noModel.message).not.toContain('with model');
  });

  test('remove_reminder validates, removes an existing one, and reports a missing one', async () => {
    expect((await json('macrodata_remove_reminder', {})).success).toBe(false);
    await run('macrodata_schedule_reminder', {
      id: 'rm',
      cronExpression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    const removed = await json('macrodata_remove_reminder', { id: 'rm' });
    expect(removed.success).toBe(true);
    const missing = await json('macrodata_remove_reminder', { id: 'nope' });
    expect(missing.success).toBe(false);
    expect(missing.message).toContain('not found');
  });

  test('list_reminders returns saved schedules and skips malformed files', async () => {
    await run('macrodata_schedule_reminder', {
      id: 'a',
      cronExpression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    writeFileSync(join(root, 'reminders', 'bad.json'), '{ not json');
    const out = await json('macrodata_list_reminders');
    expect(out.reminders.map((s: { id: string }) => s.id)).toContain('a');
  });

  test('list_reminders returns [] when the reminders dir is absent', async () => {
    const out = await json('macrodata_list_reminders');
    expect(out.reminders).toEqual([]);
  });
});

describe('get_related', () => {
  test('validates and returns the not-implemented placeholder', async () => {
    expect((await json('macrodata_get_related', {})).success).toBe(false);
    const out = await json('macrodata_get_related', { id: 'some-id' });
    expect(out.success).toBe(true);
    expect(out.message).toContain('not yet implemented');
  });
});
