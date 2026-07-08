/**
 * Tests for the OpenCode plugin factory (opencode/index.ts).
 *
 * os.homedir is redirected to a temp dir and child_process.spawn is stubbed so
 * the daemon-management + skill-install side effects run against temp paths and
 * never launch a real process or touch the real config.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const spawnMock = vi.fn((..._args: unknown[]) => ({ unref: () => {} }));
let fakeHome: string;

vi.mock('child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

fakeHome = mkdtempSync(join(tmpdir(), 'macrodata-plugin-home-'));

const { MacrodataPlugin } = await import('../opencode/index');

let stateRoot: string;
let prevRoot: string | undefined;
let killSpy: ReturnType<typeof vi.spyOn>;

function configDir() {
  return join(fakeHome, '.config', 'macrodata');
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      config: { providers: async () => ({ data: { providers: [] } }) },
    },
    ...overrides,
  } as never;
}

type PluginHooks = {
  tool: unknown;
  'experimental.chat.system.transform': (input: never, output: never) => Promise<void>;
  'experimental.session.compacting': (input: never, output: never) => Promise<void>;
};

async function loadPlugin(ctx = makeCtx()): Promise<PluginHooks> {
  return (await MacrodataPlugin(ctx)) as unknown as PluginHooks;
}

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), 'macrodata-plugin-state-'));
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = stateRoot;
  mkdirSync(configDir(), { recursive: true });
  spawnMock.mockClear();
  killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
  rmSync(configDir(), { recursive: true, force: true });
  killSpy.mockRestore();
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe('plugin factory', () => {
  test('initializes state, starts the daemon, and returns the hook set', async () => {
    const hooks = await loadPlugin();
    expect(existsSync(join(stateRoot, 'state'))).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(hooks.tool).toBeDefined();
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function');
    expect(typeof hooks['experimental.session.compacting']).toBe('function');
  });

  test('does not restart the daemon when the PID is alive with a fresh heartbeat', async () => {
    writeFileSync(join(configDir(), '.daemon.pid'), String(process.pid));
    writeFileSync(join(stateRoot, '.daemon.heartbeat'), String(Date.now()));
    await loadPlugin();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('restarts the daemon when the PID is alive but the heartbeat is stale', async () => {
    writeFileSync(join(configDir(), '.daemon.pid'), String(process.pid));
    writeFileSync(join(stateRoot, '.daemon.heartbeat'), String(Date.now() - 20 * 60_000));
    await loadPlugin();
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test('starts the daemon when the PID file holds a dead process', async () => {
    killSpy.mockImplementation(() => {
      throw new Error('no such process');
    });
    writeFileSync(join(configDir(), '.daemon.pid'), '2147483646');
    await loadPlugin();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test('does not restart when the PID is alive and no heartbeat file exists', async () => {
    // No heartbeat file → isHeartbeatStale returns false → daemon left running.
    writeFileSync(join(configDir(), '.daemon.pid'), String(process.pid));
    await loadPlugin();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('treats a malformed heartbeat as fresh (not stale)', async () => {
    writeFileSync(join(configDir(), '.daemon.pid'), String(process.pid));
    writeFileSync(join(stateRoot, '.daemon.heartbeat'), 'not-a-number');
    await loadPlugin();
    // NaN lastBeat → Number.isFinite false → not stale → no restart.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('treats an unreadable heartbeat file as fresh', async () => {
    writeFileSync(join(configDir(), '.daemon.pid'), String(process.pid));
    // A directory at the heartbeat path makes readFileSync throw → catch → false.
    mkdirSync(join(stateRoot, '.daemon.heartbeat'), { recursive: true });
    await loadPlugin();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test('logs an error when spawning the daemon fails', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn denied');
    });
    await expect(loadPlugin()).resolves.toBeDefined();
    spawnMock.mockImplementation(() => ({ unref: () => {} }));
  });

  test('signals SIGHUP to a running daemon after start', async () => {
    // A pid file present + alive means signalDaemonReload sends SIGHUP.
    writeFileSync(join(configDir(), '.daemon.pid'), String(process.pid));
    writeFileSync(join(stateRoot, '.daemon.heartbeat'), String(Date.now()));
    await loadPlugin();
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGHUP');
  });
});

describe('system.transform hook', () => {
  test('pushes pending context and memory context', async () => {
    // A first-run root (no identity) yields onboarding context.
    writeFileSync(join(stateRoot, '.pending-context'), 'pending line');
    const hooks = await loadPlugin();
    const output = { system: [] as string[] };
    await hooks['experimental.chat.system.transform']({} as never, output as never);
    expect(output.system).toContain('pending line');
    expect(output.system.some((s) => s.includes('First Run'))).toBe(true);
  });

  test('swallows errors from context formatting', async () => {
    const hooks = await loadPlugin();
    const badOutput = {
      system: {
        push() {
          throw new Error('push failed');
        },
      },
    };
    await expect(
      hooks['experimental.chat.system.transform']({} as never, badOutput as never),
    ).resolves.toBeUndefined();
  });
});

describe('session.compacting hook', () => {
  test('pushes compaction context when identity exists', async () => {
    mkdirSync(join(stateRoot, 'state'), { recursive: true });
    writeFileSync(join(stateRoot, 'state', 'identity.md'), '# Identity');
    const hooks = await loadPlugin();
    const output = { context: [] as string[] };
    await hooks['experimental.session.compacting']({} as never, output as never);
    expect(output.context.length).toBeGreaterThan(0);
  });

  test('pushes nothing during compaction on first run', async () => {
    // First run + compaction → formatContextForPrompt returns null → no push.
    const hooks = await loadPlugin();
    const output = { context: [] as string[] };
    await hooks['experimental.session.compacting']({} as never, output as never);
    expect(output.context).toEqual([]);
  });

  test('swallows push errors during compaction', async () => {
    // identity present → non-null compaction context → push is attempted.
    mkdirSync(join(stateRoot, 'state'), { recursive: true });
    writeFileSync(join(stateRoot, 'state', 'identity.md'), '# Identity');
    const hooks = await loadPlugin();
    const badOutput = {
      context: {
        push() {
          throw new Error('push failed');
        },
      },
    };
    await expect(
      hooks['experimental.session.compacting']({} as never, badOutput as never),
    ).resolves.toBeUndefined();
  });
});
