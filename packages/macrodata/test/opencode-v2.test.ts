/**
 * Tests for the OpenCode 2 half of the dual entrypoint (opencode/index.ts +
 * opencode/v2.ts, #152).
 *
 * The default export carries both shapes: V1 calls `server()`, V2 calls
 * `setup(ctx)`. `ctx` is a hand-built fake of the `@opencode/plugin` Context
 * that records hook / transform registrations so each can be driven directly.
 * os.homedir is redirected and child_process.spawn is stubbed exactly as in the
 * V1 factory tests.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const spawnMock = vi.fn((..._args: unknown[]) => ({ unref: () => {} }));
let fakeHome: string;

vi.mock('child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

fakeHome = mkdtempSync(join(tmpdir(), 'macrodata-v2-home-'));

const plugin = (await import('../opencode/index')).default;
const { bridgeTool, loadBundledSkills, providersFromModels } = await import('../opencode/v2');

type TextPart = { type: 'text'; text: string };
type Hook = (event: never) => Promise<void> | void;
type ToolInfo = {
  name: string;
  description: string;
  input: unknown;
  execute: (input: unknown, context: unknown) => Promise<{ content: string }>;
};
type SkillInfo = { id: string; name: string; description?: string; path: string; content: string };

function makeV2Ctx(overrides: { models?: unknown[] } = {}) {
  const hooks = new Map<string, Hook>();
  const tools: ToolInfo[] = [];
  const skills: SkillInfo[] = [];
  const registration = { dispose: async () => {} };
  const ctx = {
    location: {
      directory: '/tmp/proj',
      project: { id: 'prj', directory: '/tmp/proj', canonical: '/tmp/proj' },
    },
    session: {
      hook: vi.fn(async (name: string, cb: Hook) => {
        hooks.set(name, cb);
        return registration;
      }),
    },
    tool: {
      transform: vi.fn(async (cb: (editor: { add: (t: ToolInfo) => void }) => void) => {
        cb({ add: (t) => tools.push(t) });
        return registration;
      }),
    },
    skill: {
      transform: vi.fn(async (cb: (editor: { add: (s: SkillInfo) => void }) => void) => {
        cb({ add: (s) => skills.push(s) });
        return registration;
      }),
    },
    model: {
      list: vi.fn(async () => ({ data: overrides.models ?? [] })),
    },
  };
  return { ctx, hooks, tools, skills };
}

let stateRoot: string;
let prevRoot: string | undefined;
let killSpy: ReturnType<typeof vi.spyOn>;

function configDir() {
  return join(fakeHome, '.config', 'macrodata');
}

function seedIdentity() {
  mkdirSync(join(stateRoot, 'state'), { recursive: true });
  writeFileSync(join(stateRoot, 'state', 'identity.md'), '# Identity');
}

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), 'macrodata-v2-state-'));
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = stateRoot;
  mkdirSync(configDir(), { recursive: true });
  spawnMock.mockClear();
  killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
  rmSync(join(fakeHome, '.config'), { recursive: true, force: true });
  killSpy.mockRestore();
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('default export shape', () => {
  test('is a Plugin.define object that also carries the V1 server()', () => {
    expect(plugin.id).toBe('geoql.mdr');
    expect(typeof plugin.setup).toBe('function');
    expect(typeof plugin.server).toBe('function');
  });

  test('server() returns the unchanged V1 hook set', async () => {
    const hooks = (await plugin.server({
      client: { config: { providers: async () => ({ data: { providers: [] } }) } },
    } as never)) as Record<string, unknown>;
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function');
    expect(typeof hooks['chat.message']).toBe('function');
    expect(typeof hooks['experimental.session.compacting']).toBe('function');
    expect(hooks.tool).toBeDefined();
  });
});

describe('setup(ctx)', () => {
  test('initializes state, starts the daemon, registers hooks/tools/skills, returns cleanup', async () => {
    const { ctx, hooks, tools, skills } = makeV2Ctx();

    const cleanup = await plugin.setup(ctx as never);

    expect(existsSync(join(stateRoot, 'state'))).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect([...hooks.keys()].sort()).toEqual(['compaction', 'context', 'prompt']);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'macrodata_get_memory_index_stats',
      'macrodata_get_recent_journal',
      'macrodata_get_recent_summaries',
      'macrodata_get_related',
      'macrodata_list_reminders',
      'macrodata_log_journal',
      'macrodata_rebuild_memory_index',
      'macrodata_remove_reminder',
      'macrodata_save_conversation_summary',
      'macrodata_schedule_once',
      'macrodata_schedule_reminder',
      'macrodata_search_conversations',
      'macrodata_search_memory',
    ]);
    expect(skills.map((s) => s.id).sort()).toEqual([
      'macrodata-distill',
      'macrodata-dreamtime',
      'macrodata-memory-maintenance',
      'macrodata-onboarding',
    ]);
    expect(typeof cleanup).toBe('function');
    expect((cleanup as () => void)()).toBeUndefined();
  });

  test('does not copy skills into ~/.config/opencode/skills on the V2 path', async () => {
    const { ctx } = makeV2Ctx();
    await plugin.setup(ctx as never);
    expect(existsSync(join(fakeHome, '.config', 'opencode', 'skills'))).toBe(false);
  });
});

describe('context hook', () => {
  test('pushes the frozen memory context as a structured text part', async () => {
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = { sessionID: 'ses_1', system: [] as TextPart[] };

    await hooks.get('context')!(event as never);

    expect(event.system).toHaveLength(1);
    expect(event.system[0].type).toBe('text');
    expect(event.system[0].text).toContain('First Run');
  });

  test('builds the models section from ctx.model.list()', async () => {
    seedIdentity();
    const { ctx, hooks } = makeV2Ctx({
      models: [
        {
          id: 'claude-sonnet-5',
          providerID: 'anthropic',
          family: 'claude-sonnet',
          time: { released: Date.UTC(2026, 0, 2) },
          capabilities: { tools: true },
        },
        {
          id: 'no-tools',
          providerID: 'anthropic',
          time: { released: Date.UTC(2026, 0, 2) },
          capabilities: { tools: false },
        },
      ],
    });
    await plugin.setup(ctx as never);
    const event = { sessionID: 'ses_models', system: [] as TextPart[] };

    await hooks.get('context')!(event as never);

    expect(ctx.model.list).toHaveBeenCalled();
    expect(event.system[0].text).toContain('anthropic/claude-sonnet-5');
    expect(event.system[0].text).not.toContain('anthropic/no-tools');
  });

  test('swallows errors', async () => {
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = {
      sessionID: 'ses_bad',
      system: {
        push() {
          throw new Error('push failed');
        },
      },
    };
    await expect(hooks.get('context')!(event as never)).resolves.toBeUndefined();
  });
});

describe('prompt hook', () => {
  test('appends pending daemon context to the prompt text as a system reminder', async () => {
    writeFileSync(join(stateRoot, '.pending-context'), 'pending line');
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = { sessionID: 'ses_1', messageID: 'msg_1', prompt: { text: 'hi', files: [] } };

    await hooks.get('prompt')!(event as never);

    expect(event.prompt.text.startsWith('hi')).toBe(true);
    expect(event.prompt.text).toContain('<system-reminder>');
    expect(event.prompt.text).toContain('pending line');
    expect(existsSync(join(stateRoot, '.pending-context'))).toBe(false);
  });

  test('appends changed context sections after the session snapshot froze', async () => {
    seedIdentity();
    writeFileSync(join(stateRoot, 'state', 'today.md'), 'first');
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    await hooks.get('context')!({ sessionID: 'ses_delta', system: [] } as never);
    writeFileSync(join(stateRoot, 'state', 'today.md'), 'second');
    const event = { sessionID: 'ses_delta', messageID: 'msg_2', prompt: { text: 'next' } };

    await hooks.get('prompt')!(event as never);

    expect(event.prompt.text).toContain('<macrodata-update>');
    expect(event.prompt.text).toContain('second');
  });

  test('leaves the prompt untouched when nothing is pending and nothing changed', async () => {
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = { sessionID: 'ses_none', messageID: 'msg_3', prompt: { text: 'plain' } };

    await hooks.get('prompt')!(event as never);

    expect(event.prompt.text).toBe('plain');
  });

  test('swallows errors', async () => {
    writeFileSync(join(stateRoot, '.pending-context'), 'pending line');
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = {
      sessionID: 'ses_bad',
      messageID: 'msg_4',
      prompt: {
        get text() {
          return 'x';
        },
        set text(_value: string) {
          throw new Error('readonly');
        },
      },
    };
    await expect(hooks.get('prompt')!(event as never)).resolves.toBeUndefined();
  });
});

describe('compaction hook', () => {
  test('pushes compaction context when identity exists', async () => {
    seedIdentity();
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = { sessionID: 'ses_1', system: [] as TextPart[] };

    await hooks.get('compaction')!(event as never);

    expect(event.system).toHaveLength(1);
    expect(event.system[0]).toMatchObject({ type: 'text' });
    expect(event.system[0].text).toContain('<macrodata>');
  });

  test('pushes nothing on first run', async () => {
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = { sessionID: 'ses_1', system: [] as TextPart[] };
    await hooks.get('compaction')!(event as never);
    expect(event.system).toEqual([]);
  });

  test('swallows errors', async () => {
    seedIdentity();
    const { ctx, hooks } = makeV2Ctx();
    await plugin.setup(ctx as never);
    const event = {
      sessionID: 'ses_bad',
      system: {
        push() {
          throw new Error('push failed');
        },
      },
    };
    await expect(hooks.get('compaction')!(event as never)).resolves.toBeUndefined();
  });
});

describe('bridgeTool', () => {
  const v1 = {
    description: 'echo',
    args: {},
    execute: vi.fn(async (_args: unknown, _context: unknown) => 'result-string'),
  };
  const toolContext = {
    sessionID: 'ses_t',
    messageID: 'msg_t',
    agent: 'build',
    id: 'call_1',
    signal: new AbortController().signal,
    progress: async () => {},
  };
  const location = {
    directory: '/tmp/proj',
    project: { id: 'prj', directory: '/tmp/root', canonical: '/tmp/root' },
  };

  test('keeps the name, wraps the string result as content, and bridges the context', async () => {
    const info = bridgeTool('macrodata_echo', v1 as never, location as never);
    expect(info.name).toBe('macrodata_echo');
    expect(info.description).toBe('echo');

    const result = await info.execute({}, toolContext as never);

    expect(result).toEqual({ content: 'result-string' });
    const bridged = v1.execute.mock.calls[0][1] as {
      sessionID: string;
      messageID: string;
      agent: string;
      directory: string;
      worktree: string;
      abort: AbortSignal;
      metadata: (input: { title?: string }) => void;
      ask: (input: unknown) => Promise<void>;
    };
    expect(bridged).toMatchObject({
      sessionID: 'ses_t',
      messageID: 'msg_t',
      agent: 'build',
      directory: '/tmp/proj',
      worktree: '/tmp/root',
    });
    expect(bridged.abort).toBe(toolContext.signal);
    expect(bridged.metadata({ title: 'x' })).toBeUndefined();
    await expect(bridged.ask({})).rejects.toThrow(/not supported/);
  });

  test('unwraps a structured V1 result to its output text', async () => {
    const structured = {
      description: 'structured',
      args: {},
      execute: async () => ({ title: 't', output: 'out-text' }),
    };
    const info = bridgeTool('macrodata_s', structured as never, location as never);
    await expect(info.execute({}, toolContext as never)).resolves.toEqual({
      content: 'out-text',
    });
  });

  test('exposes the V1 zod args as a standard-schema object input', async () => {
    const { tool } = await import('@opencode-ai/plugin');
    const withArgs = tool({
      description: 'd',
      args: { topic: tool.schema.string() },
      async execute() {
        return 'ok';
      },
    });
    const info = bridgeTool('macrodata_args', withArgs, location as never);
    const standard = info.input as { '~standard': { validate: (v: unknown) => unknown } };
    expect(typeof standard['~standard'].validate).toBe('function');
    expect(standard['~standard'].validate({ topic: 'x' })).toMatchObject({ value: { topic: 'x' } });
  });
});

describe('loadBundledSkills', () => {
  test('parses frontmatter and strips it from content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macrodata-skills-'));
    mkdirSync(join(dir, 'alpha'));
    writeFileSync(
      join(dir, 'alpha', 'SKILL.md'),
      '---\nname: alpha\nno colon on this line\ndescription: The alpha skill\n---\n\n# Alpha\n\nBody here.\n',
    );
    mkdirSync(join(dir, 'no-manifest'));
    writeFileSync(join(dir, 'stray.md'), 'not a skill');

    const skills = loadBundledSkills(dir);

    expect(skills).toEqual([
      {
        id: 'alpha',
        name: 'alpha',
        description: 'The alpha skill',
        path: join(dir, 'alpha', 'SKILL.md'),
        content: '# Alpha\n\nBody here.',
      },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('falls back to the directory name when frontmatter is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'macrodata-skills-'));
    mkdirSync(join(dir, 'bare'));
    writeFileSync(join(dir, 'bare', 'SKILL.md'), '# Bare\n');

    expect(loadBundledSkills(dir)).toEqual([
      { id: 'bare', name: 'bare', path: join(dir, 'bare', 'SKILL.md'), content: '# Bare' },
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns [] when the skills directory does not exist', () => {
    expect(loadBundledSkills(join(tmpdir(), 'macrodata-no-such-skills'))).toEqual([]);
  });

  test('ships the four bundled skills', () => {
    const skillsDir = fileURLToPath(new URL('../opencode/skills', import.meta.url));
    const bundled = loadBundledSkills(skillsDir);
    const onDisk = readFileSync(join(skillsDir, 'macrodata-onboarding', 'SKILL.md'), 'utf-8');
    expect(bundled.map((s) => s.name).sort()).toEqual([
      'macrodata-distill',
      'macrodata-dreamtime',
      'macrodata-memory-maintenance',
      'macrodata-onboarding',
    ]);
    expect(onDisk).toContain(bundled.find((s) => s.name === 'macrodata-onboarding')!.content);
  });
});

describe('providersFromModels', () => {
  test('groups models by provider in the V1 client shape', () => {
    const providers = providersFromModels([
      {
        id: 'm1',
        providerID: 'p1',
        family: 'fam',
        time: { released: Date.UTC(2026, 4, 1) },
        capabilities: { tools: true },
      },
      { id: 'm2', providerID: 'p1', time: { released: 0 }, capabilities: { tools: false } },
      { id: 'm3', providerID: 'p2', time: { released: 0 }, capabilities: { tools: true } },
    ] as never);

    expect(providers).toEqual([
      {
        id: 'p1',
        models: {
          m1: { family: 'fam', release_date: '2026-05-01', capabilities: { toolcall: true } },
          m2: { family: undefined, release_date: '1970-01-01', capabilities: { toolcall: false } },
        },
      },
      {
        id: 'p2',
        models: {
          m3: { family: undefined, release_date: '1970-01-01', capabilities: { toolcall: true } },
        },
      },
    ]);
  });
});
