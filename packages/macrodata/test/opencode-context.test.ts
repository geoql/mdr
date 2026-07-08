/**
 * Tests for opencode/context.ts: consumePendingContext, initializeStateRoot,
 * and formatContextForPrompt across first-run, full-context, compaction, and
 * model-listing branches. detectUser is mocked so the first-run path is
 * deterministic and does not shell out.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('../src/detect-user.js', () => ({
  detectUser: () => ({
    username: 'tester',
    fullName: 'Test User',
    timezone: 'UTC',
    git: { name: 'T', email: 't@e.co' },
    github: {},
    codeDirs: [],
  }),
}));

const { consumePendingContext, initializeStateRoot, formatContextForPrompt } =
  await import('../opencode/context');

let root: string;
let prevRoot: string | undefined;

function writeState(name: string, body: string) {
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, 'state', name), body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'macrodata-occtx-'));
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = root;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('consumePendingContext', () => {
  test('returns null when there is no pending file', () => {
    expect(consumePendingContext()).toBeNull();
  });

  test('reads and deletes the pending file', () => {
    writeFileSync(join(root, '.pending-context'), 'some pending text');
    expect(consumePendingContext()).toBe('some pending text');
    expect(existsSync(join(root, '.pending-context'))).toBe(false);
  });

  test('returns null for an empty pending file', () => {
    writeFileSync(join(root, '.pending-context'), '   ');
    expect(consumePendingContext()).toBeNull();
  });

  test('returns null when the pending file cannot be read', () => {
    // A directory at the pending path makes readFileSync throw.
    mkdirSync(join(root, '.pending-context'), { recursive: true });
    expect(consumePendingContext()).toBeNull();
  });
});

describe('initializeStateRoot', () => {
  test('creates the full directory tree', () => {
    initializeStateRoot();
    for (const d of ['state', 'journal', 'entities/people', 'entities/projects', 'topics']) {
      expect(existsSync(join(root, d))).toBe(true);
    }
    // Second call is a no-op (dirs already exist).
    initializeStateRoot();
    expect(existsSync(join(root, 'topics'))).toBe(true);
  });
});

describe('formatContextForPrompt first run', () => {
  test('returns onboarding context with detected user info', async () => {
    const out = await formatContextForPrompt();
    expect(out).toContain('Status: First Run');
    expect(out).toContain('"username": "tester"');
  });

  test('returns null on first run during compaction', async () => {
    expect(await formatContextForPrompt({ forCompaction: true })).toBeNull();
  });
});

describe('formatContextForPrompt full context', () => {
  beforeEach(() => {
    writeState('identity.md', '# Identity\n\nI am Atlas.');
    writeState('today.md', 'focus today');
    writeState('human.md', 'the human');
  });

  test('includes identity/today/human, journal, schedules and file listing', async () => {
    mkdirSync(join(root, 'journal'), { recursive: true });
    writeFileSync(
      join(root, 'journal', '2025-01-01.jsonl'),
      [
        JSON.stringify({
          timestamp: '2025-01-01T00:00:00Z',
          topic: 'work',
          content: 'line one\nline two',
        }),
        JSON.stringify({ timestamp: 'not-a-date', topic: 'bad', content: 'unknown date entry' }),
      ].join('\n') + '\n',
    );
    mkdirSync(join(root, 'reminders'), { recursive: true });
    writeFileSync(
      join(root, 'reminders', 'r1.json'),
      JSON.stringify({
        id: 'r1',
        type: 'cron',
        expression: '0 9 * * *',
        description: 'morning',
        payload: 'p',
        createdAt: 'x',
      }),
    );
    writeState('workspace.md', 'the workspace');
    mkdirSync(join(root, 'entities', 'people'), { recursive: true });
    writeFileSync(join(root, 'entities', 'people', 'alice.md'), '# Alice');

    const out = (await formatContextForPrompt())!;
    expect(out).toContain('<macrodata-identity>');
    expect(out).toContain('<macrodata-workspace>');
    expect(out).toContain('[work] line one (');
    expect(out).toContain('(unknown)');
    expect(out).toContain('morning (cron: 0 9 * * *)');
    expect(out).toContain('state/workspace.md');
    expect(out).toContain('entities/people/alice.md');
  });

  test('omits workspace and shows empty journal/schedule placeholders', async () => {
    const out = (await formatContextForPrompt())!;
    expect(out).not.toContain('<macrodata-workspace>');
    expect(out).toContain('_No entries_');
    expect(out).toContain('_No active schedules_');
  });

  test('caps journal entries and tolerates broken reminders + non-dir entities', async () => {
    mkdirSync(join(root, 'journal'), { recursive: true });
    // More than 5 entries across three files exercises both count-cap breaks
    // (the outer file-loop break triggers before the third file is read).
    for (let d = 1; d <= 3; d++) {
      const lines = [];
      for (let i = 0; i < 4; i++) {
        lines.push(
          JSON.stringify({
            timestamp: `2025-01-0${d}T0${i}:00:00Z`,
            topic: 't',
            content: `e${d}${i}`,
          }),
        );
      }
      writeFileSync(join(root, 'journal', `2025-01-0${d}.jsonl`), lines.join('\n') + '\n');
    }
    // A file where a reminders dir is expected → getSchedules readdir throws.
    writeFileSync(join(root, 'reminders'), 'not a dir');
    // A file inside entities (not a subdir) → the entity scan skips it.
    mkdirSync(join(root, 'entities'), { recursive: true });
    writeFileSync(join(root, 'entities', 'stray.txt'), 'loose');

    const out = (await formatContextForPrompt())!;
    expect(out).toContain('<macrodata-journal>');
    expect(out).toContain('_No active schedules_');
  });

  test('shows placeholder text for empty identity/today/human files', async () => {
    // identity.md exists (so not first-run) but is empty, as are today/human.
    writeState('identity.md', '');
    writeState('today.md', '');
    writeState('human.md', '');
    const out = (await formatContextForPrompt())!;
    expect(out).toContain('_Not configured_');
    expect(out).toContain('<macrodata-today>\n_Empty_');
    expect(out).toContain('<macrodata-human>\n_Empty_');
  });

  test('skips schedules and file listing during compaction', async () => {
    const out = (await formatContextForPrompt({ forCompaction: true }))!;
    expect(out).not.toContain('<macrodata-schedules>');
    expect(out).not.toContain('<macrodata-files');
  });

  test('lists deduped latest-per-family toolcall models from the client', async () => {
    const client = {
      config: {
        providers: async () => ({
          data: {
            providers: [
              {
                id: 'anthropic',
                models: {
                  'claude-x-newer': {
                    family: 'claude',
                    release_date: '2025-06-01',
                    capabilities: { toolcall: true },
                  },
                  'claude-x': {
                    family: 'claude',
                    release_date: '2025-01-01',
                    capabilities: { toolcall: true },
                  }, // older, seen after newer
                  'claude-20240101': { family: 'claude', capabilities: { toolcall: true } }, // dated -> skipped
                  'no-tools': { family: 'misc', capabilities: { toolcall: false } }, // skipped
                  'no-caps': { family: 'other' }, // no capabilities -> skipped
                },
              },
            ],
          },
        }),
      },
    };
    const out = (await formatContextForPrompt({ client }))!;
    expect(out).toContain('<macrodata-models>');
    expect(out).toContain('anthropic/claude-x-newer');
    expect(out).not.toContain('claude-20240101');
    expect(out).not.toContain('no-tools');
  });

  test('handles providers without models and models without a family', async () => {
    const client = {
      config: {
        providers: async () => ({
          data: {
            providers: [
              { id: 'empty' }, // no models key -> skipped
              {
                id: 'openai',
                models: {
                  'gpt-x': { capabilities: { toolcall: true } }, // no family -> uses fullId
                },
              },
            ],
          },
        }),
      },
    };
    const out = (await formatContextForPrompt({ client }))!;
    expect(out).toContain('openai/gpt-x');
  });

  test('omits the models tag when no model qualifies', async () => {
    const client = {
      config: {
        providers: async () => ({
          data: {
            providers: [
              { id: 'p', models: { 'only-dated-20250101': { capabilities: { toolcall: true } } } },
            ],
          },
        }),
      },
    };
    const out = (await formatContextForPrompt({ client }))!;
    expect(out).not.toContain('<macrodata-models>');
  });

  test('tolerates a client whose providers call rejects', async () => {
    const client = {
      config: {
        providers: async () => {
          throw new Error('provider fetch failed');
        },
      },
    };
    const out = (await formatContextForPrompt({ client }))!;
    expect(out).not.toContain('<macrodata-models>');
  });

  test('handles a client that returns no providers', async () => {
    const client = { config: { providers: async () => ({ data: {} }) } };
    const out = (await formatContextForPrompt({ client }))!;
    expect(out).not.toContain('<macrodata-models>');
  });
});
