/**
 * Error-path tests for the local MCP server.
 *
 * The indexer / conversation modules are mocked to throw so the tool handlers'
 * catch branches run, and the stdio transport is stubbed so main() can be
 * exercised without opening a real stdio channel.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestContext, type TestContext } from './helpers';

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {
    async start() {}
    async close() {}
    async send() {}
  },
}));

vi.mock('../src/indexer.js', () => ({
  indexJournalEntry: vi.fn().mockRejectedValue(new Error('index down')),
  rebuildIndex: vi.fn().mockRejectedValue(new Error('rebuild down')),
  getIndexStats: vi.fn().mockRejectedValue(new Error('stats down')),
  searchMemory: vi.fn().mockRejectedValue(new Error('search down')),
}));

vi.mock('../src/conversations.js', () => ({
  searchConversations: vi.fn().mockRejectedValue(new Error('conv search down')),
  expandConversation: vi.fn(),
  rebuildConversationIndex: vi.fn().mockResolvedValue({ exchangeCount: 0 }),
  updateConversationIndex: vi
    .fn()
    .mockResolvedValue({ filesUpdated: 0, skipped: 0, exchangeCount: 0 }),
  getConversationIndexStats: vi.fn().mockRejectedValue(new Error('conv stats down')),
}));

import { createServer, main, isRunAsMain } from '../src/index';

let ctx: TestContext;
let client: Client;

function textOf(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }> };
  return r.content.map((c) => c.text).join('\n');
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  return textOf(await client.callTool({ name, arguments: args }));
}

beforeEach(async () => {
  ctx = createTestContext('macrodata-mcp-err-');
  const server = createServer();
  client = new Client({ name: 'err', version: '1.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
});

afterEach(async () => {
  await client.close();
  ctx.cleanup();
});

describe('handler error branches', () => {
  test('log_journal still succeeds when indexing throws', async () => {
    const out = await call('log_journal', { topic: 't', content: 'c' });
    expect(out).toContain('Logged to journal');
  });

  test('save_conversation_summary still succeeds when indexing throws', async () => {
    const out = await call('save_conversation_summary', { summary: 's' });
    expect(out).toContain('Conversation summary saved');
  });

  test('search_memory returns a search error message', async () => {
    const out = await call('search_memory', { query: 'q' });
    expect(out).toContain('Search error');
  });

  test('manage_index reports a failure when the memory rebuild throws', async () => {
    const out = await call('manage_index', { target: 'memory', action: 'rebuild' });
    expect(out).toContain('Failed to rebuild memory index');
  });

  test('manage_index reports a failure when conversation stats throw', async () => {
    const out = await call('manage_index', { target: 'conversations', action: 'stats' });
    expect(out).toContain('Failed to stats conversations index');
  });

  test('search_conversations returns a search error message', async () => {
    const out = await call('search_conversations', { query: 'q' });
    expect(out).toContain('Search error');
  });

  test('conversation rebuild/update run their background success callbacks', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await call('manage_index', { target: 'conversations', action: 'rebuild' });
    await call('manage_index', { target: 'conversations', action: 'update' });
    // Let the fire-and-forget .then() callbacks flush.
    await new Promise((r) => setTimeout(r, 20));
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('Conversation index rebuilt');
    expect(logged).toContain('Conversation index updated');
    logSpy.mockRestore();
  });

  test('conversation rebuild/update run their background error callbacks', async () => {
    const convos = await import('../src/conversations.js');
    vi.mocked(convos.rebuildConversationIndex).mockRejectedValueOnce(new Error('bg rebuild fail'));
    vi.mocked(convos.updateConversationIndex).mockRejectedValueOnce(new Error('bg update fail'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await call('manage_index', { target: 'conversations', action: 'rebuild' });
    await call('manage_index', { target: 'conversations', action: 'update' });
    await new Promise((r) => setTimeout(r, 20));
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('Conversation index rebuild failed');
    expect(logged).toContain('Conversation index update failed');
    errSpy.mockRestore();
  });
});

describe('main', () => {
  test('connects the server to a stdio transport', async () => {
    await expect(main()).resolves.toBeUndefined();
  });
});

describe('isRunAsMain', () => {
  test('is true only when argv[1] matches the module url', () => {
    expect(isRunAsMain('/abs/index.js', 'file:///abs/index.js')).toBe(true);
    expect(isRunAsMain('/abs/index.js', 'file:///other.js')).toBe(false);
    expect(isRunAsMain(undefined, 'file:///abs/index.js')).toBe(false);
  });
});
