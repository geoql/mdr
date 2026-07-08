/**
 * Tests for the local MCP server (src/index.ts).
 *
 * The server is exercised end-to-end through the SDK's in-memory transport: a
 * real Client is linked to the server and every tool is invoked, so the tool
 * handler bodies run for real against isolated temp state.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index';
import { createTestContext, addReminder, addJournalEntry, type TestContext } from './helpers';

let ctx: TestContext;
let client: Client;

function textOf(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }> };
  return r.content.map((c) => c.text).join('\n');
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  return textOf(result);
}

beforeEach(async () => {
  ctx = createTestContext('macrodata-mcp-');
  const server = createServer();
  client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  ctx.cleanup();
});

describe('tool registration', () => {
  test('registers all 11 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'expand_conversation',
        'get_recent_journal',
        'get_recent_summaries',
        'list_reminders',
        'log_journal',
        'manage_index',
        'remove_reminder',
        'save_conversation_summary',
        'schedule',
        'search_conversations',
        'search_memory',
      ].sort(),
    );
  });
});

describe('log_journal', () => {
  test("writes a journal entry to today's file", async () => {
    const out = await call('log_journal', {
      topic: 'testing',
      content: 'wrote a test',
      source: 'unit',
      intent: 'coverage',
    });
    expect(out).toContain('Logged to journal: testing');

    const today = new Date().toISOString().split('T')[0];
    const file = join(ctx.journalDir, `${today}.jsonl`);
    expect(existsSync(file)).toBe(true);
    const entry = JSON.parse(readFileSync(file, 'utf-8').trim());
    expect(entry.topic).toBe('testing');
    expect(entry.metadata).toEqual({ source: 'unit', intent: 'coverage' });
  });
});

describe('get_recent_journal', () => {
  test('returns recent entries filtered by topic', async () => {
    addJournalEntry(ctx, 'alpha', 'first entry');
    addJournalEntry(ctx, 'beta', 'second entry');

    const all = JSON.parse(await call('get_recent_journal', { count: 10 }));
    expect(all.length).toBeGreaterThanOrEqual(2);

    const filtered = JSON.parse(await call('get_recent_journal', { count: 10, topic: 'alpha' }));
    expect(filtered.every((e: { topic: string }) => e.topic === 'alpha')).toBe(true);
  });

  test('caps results across multiple files when many entries exist', async () => {
    // Two dated files, several entries each, so the per-file and per-line
    // count caps both trip.
    const d1 = new Date('2025-01-01T00:00:00.000Z');
    const d2 = new Date('2025-01-02T00:00:00.000Z');
    for (let i = 0; i < 5; i++) addJournalEntry(ctx, `t${i}`, `day1 entry ${i}`, d1);
    for (let i = 0; i < 5; i++) addJournalEntry(ctx, `u${i}`, `day2 entry ${i}`, d2);

    const out = JSON.parse(await call('get_recent_journal', { count: 2 }));
    expect(out.length).toBe(2);
  });
});

describe('search_memory', () => {
  test('returns a no-match message on an empty index', async () => {
    const out = await call('search_memory', { query: 'nothing here', limit: 3 });
    expect(out).toContain('no matches found');
  });

  test('returns formatted ranked results after indexing', async () => {
    await call('log_journal', { topic: 'cooking', content: 'made carbonara with fresh eggs' });
    const out = await call('search_memory', { query: 'italian pasta dish', limit: 5 });
    expect(out).toContain('journal');
    expect(out).toContain('carbonara');
  });

  test('formats entity results with sections and truncates long content', async () => {
    const { addEntityFile } = await import('./helpers');
    addEntityFile(ctx, 'people', 'long', `# Long\n\n## Bio\n\n${'detailed narrative '.repeat(60)}`);
    await call('manage_index', { target: 'memory', action: 'rebuild' });

    const out = await call('search_memory', {
      query: 'detailed narrative bio',
      type: 'person',
      limit: 5,
    });
    expect(out).toContain('person');
    expect(out).toContain('/ Bio');
    expect(out).toContain('...');
  });
});

describe('manage_index', () => {
  test('rebuilds and reports memory index stats', async () => {
    addJournalEntry(ctx, 'topic', 'an entry to index');
    const rebuilt = await call('manage_index', { target: 'memory', action: 'rebuild' });
    expect(rebuilt).toContain('Memory index rebuilt');

    const stats = await call('manage_index', { target: 'memory', action: 'stats' });
    expect(stats).toContain('Memory index contains');
  });

  test('reports conversation index stats', async () => {
    const stats = await call('manage_index', { target: 'conversations', action: 'stats' });
    expect(stats).toContain('Conversation index contains');
  });

  test('kicks off conversation index actions in the background', async () => {
    const rebuild = await call('manage_index', { target: 'conversations', action: 'rebuild' });
    expect(rebuild).toContain('rebuild started in background');

    const update = await call('manage_index', { target: 'conversations', action: 'update' });
    expect(update).toContain('update started in background');
  });
});

describe('schedule / list_reminders / remove_reminder', () => {
  test('creates, lists, and removes a reminder', async () => {
    const created = await call('schedule', {
      type: 'cron',
      id: 'daily',
      expression: '0 9 * * *',
      description: 'morning',
      payload: 'check in',
      model: 'prov/model',
    });
    expect(created).toContain('Created recurring reminder: daily');
    expect(created).toContain('with model prov/model');
    expect(existsSync(join(ctx.remindersDir, 'daily.json'))).toBe(true);

    const list = JSON.parse(await call('list_reminders'));
    expect(list.map((s: { id: string }) => s.id)).toContain('daily');

    const removed = await call('remove_reminder', { id: 'daily' });
    expect(removed).toContain('Removed reminder: daily');

    const missing = await call('remove_reminder', { id: 'nope' });
    expect(missing).toContain('Reminder not found: nope');
  });

  test('creates a one-shot reminder without a model', async () => {
    const out = await call('schedule', {
      type: 'once',
      id: 'once-1',
      expression: '2099-01-01T00:00:00.000Z',
      description: 'future',
      payload: 'do it',
    });
    expect(out).toContain('Created one-shot reminder: once-1');
    expect(out).not.toContain('with model');
  });
});

describe('save_conversation_summary / get_recent_summaries', () => {
  test('saves a summary with all optional fields and reads it back', async () => {
    const saved = await call('save_conversation_summary', {
      summary: 'did the thing',
      keyDecisions: ['chose vitest'],
      openThreads: ['coverage'],
      learnedPatterns: ['user likes tests'],
      notes: 'all green',
    });
    expect(saved).toContain('Conversation summary saved');

    const summaries = JSON.parse(await call('get_recent_summaries', { count: 5 }));
    expect(summaries.length).toBe(1);
    expect(summaries[0].content).toContain('did the thing');
    expect(summaries[0].content).toContain('Decisions: chose vitest');
  });

  test('get_recent_summaries reports when there are none', async () => {
    const out = await call('get_recent_summaries', { count: 5 });
    expect(out).toContain('No conversation summaries yet');
  });

  test('saves a summary with only the required field', async () => {
    const saved = await call('save_conversation_summary', { summary: 'bare summary' });
    expect(saved).toContain('Conversation summary saved');
    const summaries = JSON.parse(await call('get_recent_summaries', { count: 5 }));
    expect(summaries[0].content).toBe('bare summary');
  });
});

describe('search_conversations', () => {
  test('reports no matches on an empty conversation index', async () => {
    const out = await call('search_conversations', { query: 'anything', limit: 5 });
    expect(out).toContain('No matching conversations found');
  });

  test('formats matching conversations from a seeded index', async () => {
    const { LocalIndex } = await import('vectra');
    const { embed } = await import('../src/embeddings');
    const idx = new LocalIndex(join(ctx.indexDir, 'conversations'));
    await idx.createIndex();
    await idx.upsertItem({
      id: 'conv-1',
      vector: await embed('deploying a worker to cloudflare'),
      metadata: {
        userPrompt: 'x'.repeat(250),
        assistantSummary: 'use wrangler deploy',
        project: 'maps',
        projectPath: '/tmp/maps',
        branch: 'main',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-abc',
        sessionPath: '/tmp/sess.jsonl',
        messageUuid: 'u1',
      },
    });

    const out = await call('search_conversations', { query: 'cloudflare worker deploy', limit: 5 });
    expect(out).toContain('relevant conversation(s)');
    expect(out).toContain('maps (main)');
    expect(out).toContain('Session: sess-abc');
    expect(out).toContain('...');
  });

  test('formats a branchless match with a short prompt', async () => {
    const { LocalIndex } = await import('vectra');
    const { embed } = await import('../src/embeddings');
    const idx = new LocalIndex(join(ctx.indexDir, 'conversations'));
    await idx.createIndex();
    await idx.upsertItem({
      id: 'conv-short',
      vector: await embed('quick note about rust tiles'),
      metadata: {
        userPrompt: 'short prompt',
        assistantSummary: 'ok',
        project: 'geolith',
        projectPath: '/tmp/geolith',
        branch: '',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-xyz',
        sessionPath: '/tmp/x.jsonl',
        messageUuid: 'u2',
      },
    });

    const out = await call('search_conversations', { query: 'rust tile server', limit: 5 });
    expect(out).toContain('geolith');
    expect(out).not.toContain('geolith (');
    expect(out).not.toContain('short prompt...');
  });
});

describe('expand_conversation', () => {
  test('asks for a full path when given a bare session id', async () => {
    const out = await call('expand_conversation', { sessionPath: 'session-id-only' });
    expect(out).toContain('provide the full session path');
  });

  test('returns an error for a missing session file', async () => {
    const out = await call('expand_conversation', {
      sessionPath: join(ctx.root, 'missing-session.jsonl'),
    });
    expect(out).toContain('Failed to expand conversation');
  });

  test('formats messages from a real session file', async () => {
    const sessionPath = join(ctx.root, 'session.jsonl');
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        sessionId: 's1',
        cwd: '/tmp/project',
        gitBranch: 'main',
        message: { role: 'user', content: 'how do I test this' },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'use vitest' }] },
      }),
    ];
    writeFileSync(sessionPath, lines.join('\n') + '\n');

    const out = await call('expand_conversation', { sessionPath, contextMessages: 10 });
    expect(out).toContain('Project: project (main)');
    expect(out).toContain('how do I test this');
    expect(out).toContain('use vitest');
  });

  test('formats a session with no git branch', async () => {
    const sessionPath = join(ctx.root, 'nobranch.jsonl');
    writeFileSync(
      sessionPath,
      JSON.stringify({
        type: 'user',
        uuid: 'u1',
        sessionId: 's2',
        cwd: '/tmp/solo',
        message: { role: 'user', content: 'hello there' },
      }) + '\n',
    );
    const out = await call('expand_conversation', { sessionPath });
    expect(out).toContain('Project: solo');
    expect(out).not.toContain('Project: solo (');
  });
});

describe('directory bootstrapping', () => {
  test('log_journal creates the full state directory tree', async () => {
    await call('log_journal', { topic: 't', content: 'c' });
    expect(existsSync(join(ctx.entitiesDir, 'people'))).toBe(true);
    expect(existsSync(join(ctx.entitiesDir, 'projects'))).toBe(true);
    expect(readdirSync(ctx.journalDir).some((f) => f.endsWith('.jsonl'))).toBe(true);
  });

  test('list_reminders is empty before any reminder exists', async () => {
    const list = JSON.parse(await call('list_reminders'));
    expect(list).toEqual([]);
    addReminder(ctx, 'x', {
      type: 'cron',
      expression: '0 0 * * *',
      description: 'd',
      payload: 'p',
    });
    const after = JSON.parse(await call('list_reminders'));
    expect(after.length).toBe(1);
  });
});

describe('bare root (no pre-created directories)', () => {
  let bareRoot: string;
  let prevRoot: string | undefined;
  let bareClient: Client;

  beforeEach(async () => {
    prevRoot = process.env.MACRODATA_ROOT;
    bareRoot = mkdtempSync(join(tmpdir(), 'macrodata-bare-'));
    process.env.MACRODATA_ROOT = bareRoot;
    const server = createServer();
    bareClient = new Client({ name: 'bare', version: '1.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), bareClient.connect(ct)]);
  });

  afterEach(async () => {
    await bareClient.close();
    rmSync(bareRoot, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
    else process.env.MACRODATA_ROOT = prevRoot;
  });

  test('log_journal bootstraps every directory from nothing', async () => {
    const r = await bareClient.callTool({
      name: 'log_journal',
      arguments: { topic: 't', content: 'c' },
    });
    expect(textOf(r)).toContain('Logged to journal');
    expect(existsSync(join(bareRoot, 'entities', 'people'))).toBe(true);
  });

  test('list_reminders returns [] when the reminders dir is absent', async () => {
    const r = await bareClient.callTool({ name: 'list_reminders', arguments: {} });
    expect(JSON.parse(textOf(r))).toEqual([]);
  });

  test('schedule creates the reminders dir on demand', async () => {
    const r = await bareClient.callTool({
      name: 'schedule',
      arguments: {
        type: 'cron',
        id: 'b1',
        expression: '0 9 * * *',
        description: 'd',
        payload: 'p',
      },
    });
    expect(textOf(r)).toContain('Created recurring reminder: b1');
    expect(existsSync(join(bareRoot, 'reminders', 'b1.json'))).toBe(true);
  });

  test('get_recent_journal returns [] when the journal dir is absent', async () => {
    const r = await bareClient.callTool({ name: 'get_recent_journal', arguments: { count: 5 } });
    expect(JSON.parse(textOf(r))).toEqual([]);
  });
});
