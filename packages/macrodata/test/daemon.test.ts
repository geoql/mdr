/**
 * Unit tests for the daemon core (src/daemon.ts).
 *
 * The daemon logic was extracted from the bin entry so it can be exercised
 * in-process instead of by spawning a real detached child (which was flaky and
 * uncoverable). The child-process boundary (spawn / execSync) is mocked; the
 * scheduler, watchers, and filesystem run for real against isolated temp dirs.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createTestContext, addReminder, type TestContext } from './helpers';

// --- child_process boundary mock -------------------------------------------

interface FakeChild extends EventEmitter {
  pid?: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  unref: Mock;
  kill: Mock;
}

function makeFakeChild(pid: number | undefined = 4242, forceNoPid = false): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = forceNoPid ? undefined : pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = vi.fn();
  child.kill = vi.fn();
  return child;
}

const spawnMock = vi.fn();
const execSyncMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

// Import after the mock is registered.
import * as daemon from '~/daemon';

const {
  getDaemonDir,
  getPidFile,
  getLogFile,
  getPendingContext,
  getHeartbeatFile,
  getChildTimeoutMs,
  log,
  logError,
  writePendingContext,
  findExecutable,
  triggerAgent,
  spawnSupervisedChild,
  ensureDirectories,
  updateAllConversationIndexes,
  loadAllSchedules,
  saveSchedule,
  deleteScheduleFile,
  loadIndexer,
  loadConversationIndexers,
  defaultBackgroundIndexing,
  MacrodataLocalDaemon,
  runDaemon,
} = daemon;

let ctx: TestContext;

function readLog(): string {
  const f = getLogFile();
  return existsSync(f) ? readFileSync(f, 'utf-8') : '';
}

beforeEach(() => {
  ctx = createTestContext('macrodata-daemon-unit-');
  spawnMock.mockReset();
  execSyncMock.mockReset();
  spawnMock.mockImplementation(() => makeFakeChild());
});

afterEach(() => {
  ctx.cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('path helpers', () => {
  test('resolve under MACRODATA_ROOT', () => {
    expect(getDaemonDir()).toBe(ctx.root);
    expect(getPidFile()).toBe(join(ctx.root, '.daemon.pid'));
    expect(getLogFile()).toBe(join(ctx.root, '.daemon.log'));
    expect(getPendingContext()).toBe(join(ctx.root, '.pending-context'));
    expect(getHeartbeatFile()).toBe(join(ctx.root, '.daemon.heartbeat'));
  });
});

describe('getChildTimeoutMs', () => {
  test('defaults to 10 minutes when unset', () => {
    delete process.env.MACRODATA_CHILD_TIMEOUT_MS;
    expect(getChildTimeoutMs()).toBe(10 * 60_000);
  });

  test('honours a positive override', () => {
    process.env.MACRODATA_CHILD_TIMEOUT_MS = '2000';
    expect(getChildTimeoutMs()).toBe(2000);
    delete process.env.MACRODATA_CHILD_TIMEOUT_MS;
  });

  test('falls back to default for non-positive or invalid values', () => {
    process.env.MACRODATA_CHILD_TIMEOUT_MS = '0';
    expect(getChildTimeoutMs()).toBe(10 * 60_000);
    process.env.MACRODATA_CHILD_TIMEOUT_MS = 'not-a-number';
    expect(getChildTimeoutMs()).toBe(10 * 60_000);
    delete process.env.MACRODATA_CHILD_TIMEOUT_MS;
  });
});

describe('logging helpers', () => {
  test('log and logError append timestamped lines', () => {
    log('hello');
    logError('boom');
    const contents = readLog();
    expect(contents).toContain('hello');
    expect(contents).toContain('ERROR: boom');
  });

  test('writePendingContext appends to the pending file', () => {
    writePendingContext('<x>ctx</x>');
    expect(readFileSync(getPendingContext(), 'utf-8')).toContain('<x>ctx</x>');
  });

  test('writePendingContext logs an error when the write fails', () => {
    // Point the pending-context path at a directory so appendFileSync throws.
    const badRoot = join(ctx.root, 'pending-as-dir');
    mkdirSync(join(badRoot, '.pending-context'), { recursive: true });
    const prev = process.env.MACRODATA_ROOT;
    process.env.MACRODATA_ROOT = badRoot;
    writePendingContext('nope');
    expect(readFileSync(join(badRoot, '.daemon.log'), 'utf-8')).toContain(
      'Failed to write pending context',
    );
    process.env.MACRODATA_ROOT = prev;
  });
});

describe('findExecutable', () => {
  test('returns the resolved path', async () => {
    execSyncMock.mockReturnValue('/usr/local/bin/opencode\n');
    expect(await findExecutable('opencode')).toBe('/usr/local/bin/opencode');
  });

  test('returns null when the lookup is empty', async () => {
    execSyncMock.mockReturnValue('   \n');
    expect(await findExecutable('nope')).toBeNull();
  });

  test('returns null when which throws', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(await findExecutable('nope')).toBeNull();
  });
});

describe('triggerAgent', () => {
  test('returns false and logs when no agent is given', async () => {
    const ok = await triggerAgent(undefined, 'msg');
    expect(ok).toBe(false);
    expect(readLog()).toContain('No agent specified');
  });

  test('spawns opencode from PATH with a model flag', async () => {
    execSyncMock.mockReturnValue('/bin/opencode\n');
    const ok = await triggerAgent('opencode', 'do it', { model: 'prov/model', description: 'd' });
    expect(ok).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('/bin/opencode');
    expect(args).toContain('--model');
    expect(args).toContain('prov/model');
    expect(args[0]).toBe('run');
  });

  test('falls back to npx when opencode is not on PATH', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('no which');
    });
    const ok = await triggerAgent('opencode', 'do it');
    expect(ok).toBe(true);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('npx');
    expect(args[0]).toBe('opencode');
  });

  test('spawns claude with --print', async () => {
    const ok = await triggerAgent('claude', 'hi', { description: 'd' });
    expect(ok).toBe(true);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args[0]).toBe('--print');
  });

  test('returns false and logs when spawning throws', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    const ok = await triggerAgent('claude', 'hi');
    expect(ok).toBe(false);
    expect(readLog()).toContain('Failed to trigger claude');
  });
});

describe('spawnSupervisedChild', () => {
  test('wires stdout/stderr/exit handlers to the log', () => {
    const child = makeFakeChild(999);
    spawnMock.mockReturnValue(child);
    spawnSupervisedChild('cmd', ['a'], 'lbl');

    expect(child.unref).toHaveBeenCalled();
    child.stdout.emit('data', Buffer.from('out line'));
    child.stderr.emit('data', Buffer.from('err line'));
    child.emit('exit', 0, null);
    const contents = readLog();
    expect(contents).toContain('[lbl stdout] out line');
    expect(contents).toContain('[lbl stderr] err line');
    expect(contents).toContain('child exited (code=0');
  });

  test('logs child process errors', () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    spawnSupervisedChild('cmd', [], 'lbl');
    child.emit('error', new Error('nope'));
    expect(readLog()).toContain('child process error');
  });

  test('kills the process group after the timeout', () => {
    vi.useFakeTimers();
    process.env.MACRODATA_CHILD_TIMEOUT_MS = '2000';
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const child = makeFakeChild(555);
    spawnMock.mockReturnValue(child);

    spawnSupervisedChild('cmd', [], 'lbl');
    vi.advanceTimersByTime(2000);

    expect(killSpy).toHaveBeenCalledWith(-555, 'SIGKILL');
    expect(readLog()).toContain('exceeded 2000ms timeout');
    killSpy.mockRestore();
    delete process.env.MACRODATA_CHILD_TIMEOUT_MS;
  });

  test('falls back to child.kill when the group kill throws', () => {
    vi.useFakeTimers();
    process.env.MACRODATA_CHILD_TIMEOUT_MS = '1000';
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('no such group');
    });
    const child = makeFakeChild(777);
    spawnMock.mockReturnValue(child);

    spawnSupervisedChild('cmd', [], 'lbl');
    vi.advanceTimersByTime(1000);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    killSpy.mockRestore();
    delete process.env.MACRODATA_CHILD_TIMEOUT_MS;
  });

  test('swallows a child.kill that also throws after a group-kill failure', () => {
    vi.useFakeTimers();
    process.env.MACRODATA_CHILD_TIMEOUT_MS = '1000';
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('no group');
    });
    const child = makeFakeChild(888);
    child.kill.mockImplementation(() => {
      throw new Error('already dead');
    });
    spawnMock.mockReturnValue(child);

    expect(() => {
      spawnSupervisedChild('cmd', [], 'lbl');
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
    killSpy.mockRestore();
    delete process.env.MACRODATA_CHILD_TIMEOUT_MS;
  });

  test('skips the group kill when the child has no pid', () => {
    vi.useFakeTimers();
    process.env.MACRODATA_CHILD_TIMEOUT_MS = '1000';
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const child = makeFakeChild(0, true);
    spawnMock.mockReturnValue(child);

    spawnSupervisedChild('cmd', [], 'lbl');
    vi.advanceTimersByTime(1000);

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
    delete process.env.MACRODATA_CHILD_TIMEOUT_MS;
  });
});

describe('ensureDirectories', () => {
  test('creates any missing state directories', () => {
    rmSync(join(ctx.root, 'entities'), { recursive: true, force: true });
    rmSync(join(ctx.root, 'journal'), { recursive: true, force: true });
    ensureDirectories();
    expect(existsSync(join(ctx.root, 'entities', 'people'))).toBe(true);
    expect(existsSync(join(ctx.root, 'journal'))).toBe(true);
    expect(readLog()).toContain('Created directory');
  });
});

describe('schedule file helpers', () => {
  test('loadAllSchedules returns [] when the dir is missing', () => {
    rmSync(join(ctx.root, 'reminders'), { recursive: true, force: true });
    expect(loadAllSchedules()).toEqual([]);
  });

  test('loadAllSchedules logs when the reminders path is not a directory', () => {
    const badRoot = join(ctx.root, 'bad-load');
    mkdirSync(join(badRoot, 'state'), { recursive: true });
    writeFileSync(join(badRoot, 'reminders'), 'i am a file');
    const prev = process.env.MACRODATA_ROOT;
    process.env.MACRODATA_ROOT = badRoot;
    expect(loadAllSchedules()).toEqual([]);
    expect(readFileSync(join(badRoot, '.daemon.log'), 'utf-8')).toContain(
      'Failed to read reminders directory',
    );
    process.env.MACRODATA_ROOT = prev;
  });

  test('deleteScheduleFile logs when unlink fails', () => {
    // A directory at the .json path makes unlinkSync throw.
    mkdirSync(join(ctx.remindersDir, 'dir-id.json'), { recursive: true });
    deleteScheduleFile('dir-id');
    expect(readLog()).toContain('Failed to delete schedule file dir-id');
  });

  test('loadAllSchedules reads valid files and logs malformed ones', () => {
    addReminder(ctx, 'good', {
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    writeFileSync(join(ctx.remindersDir, 'bad.json'), '{ not json');
    const schedules = loadAllSchedules();
    expect(schedules.map((s) => s.id)).toContain('good');
    expect(readLog()).toContain('Failed to load schedule bad.json');
  });

  test('saveSchedule writes the reminder and deleteScheduleFile removes it', () => {
    saveSchedule({
      id: 's1',
      type: 'cron',
      expression: '0 0 * * *',
      description: 'd',
      payload: 'p',
      createdAt: new Date().toISOString(),
    });
    const file = join(ctx.remindersDir, 's1.json');
    expect(existsSync(file)).toBe(true);
    deleteScheduleFile('s1');
    expect(existsSync(file)).toBe(false);
    // Deleting a non-existent id is a no-op.
    expect(() => deleteScheduleFile('missing')).not.toThrow();
  });

  test('saveSchedule logs when the write fails', () => {
    // Reminders dir replaced by a file collision so writeFileSync throws.
    const badRoot = join(ctx.root, 'bad-root');
    mkdirSync(join(badRoot, 'state'), { recursive: true });
    // reminders is a FILE, not a dir → join(remindersDir, x) write fails
    writeFileSync(join(badRoot, 'reminders'), 'x');
    const prev = process.env.MACRODATA_ROOT;
    process.env.MACRODATA_ROOT = badRoot;
    saveSchedule({
      id: 's1',
      type: 'cron',
      expression: '0 0 * * *',
      description: 'd',
      payload: 'p',
      createdAt: new Date().toISOString(),
    });
    expect(readFileSync(join(badRoot, '.daemon.log'), 'utf-8')).toContain(
      'Failed to save schedule',
    );
    process.env.MACRODATA_ROOT = prev;
  });
});

describe('lazy loaders', () => {
  test('loadIndexer resolves the indexer module', async () => {
    const indexer = await loadIndexer();
    expect(typeof indexer.preloadModel).toBe('function');
  });

  test('loadConversationIndexers exposes both update functions', async () => {
    const loaders = await loadConversationIndexers();
    expect(typeof loaders.updateOpenCodeConversations).toBe('function');
    expect(typeof loaders.updateClaudeCodeConversations).toBe('function');
  });
});

describe('defaultBackgroundIndexing', () => {
  test('preloads the model and refreshes indexes via injected deps', async () => {
    const preloadModel = vi.fn().mockResolvedValue(undefined);
    const updateAll = vi.fn().mockResolvedValue(undefined);
    await defaultBackgroundIndexing({
      loadIndexer: async () => ({ preloadModel }),
      updateAll,
    });
    expect(preloadModel).toHaveBeenCalledTimes(1);
    expect(updateAll).toHaveBeenCalledTimes(1);
    expect(readLog()).toContain('Embedding model preloaded');
  });
});

describe('updateAllConversationIndexes', () => {
  test('logs updates from both indexers', async () => {
    await updateAllConversationIndexes(async () => ({
      updateClaudeCodeConversations: async () => ({ filesUpdated: 2, exchangeCount: 5 }),
      updateOpenCodeConversations: async () => ({ newCount: 3, totalCount: 8 }),
    }));
    const contents = readLog();
    expect(contents).toContain('Claude Code conversations: +2');
    expect(contents).toContain('OpenCode conversations: +3');
  });

  test('logs errors from either indexer without throwing', async () => {
    await updateAllConversationIndexes(async () => ({
      updateClaudeCodeConversations: async () => {
        throw new Error('cc fail');
      },
      updateOpenCodeConversations: async () => {
        throw new Error('oc fail');
      },
    }));
    const contents = readLog();
    expect(contents).toContain('Claude Code conversation index failed');
    expect(contents).toContain('OpenCode conversation index failed');
  });

  test('does not log when there is nothing new', async () => {
    await updateAllConversationIndexes(async () => ({
      updateClaudeCodeConversations: async () => ({ filesUpdated: 0, exchangeCount: 0 }),
      updateOpenCodeConversations: async () => ({ newCount: 0, totalCount: 0 }),
    }));
    const contents = readLog();
    expect(contents).not.toContain('Claude Code conversations: +');
    expect(contents).not.toContain('OpenCode conversations: +');
  });

  test('logs ENOENT rejections as benign skips, not errors', async () => {
    const enoent = () =>
      Object.assign(new Error("ENOENT: no such file or directory, lstat '/tmp/gone'"), {
        code: 'ENOENT',
      });
    await updateAllConversationIndexes(async () => ({
      updateClaudeCodeConversations: async () => {
        throw enoent();
      },
      updateOpenCodeConversations: async () => {
        throw enoent();
      },
    }));
    const contents = readLog();
    expect(contents).not.toContain('ERROR: Claude Code conversation index failed');
    expect(contents).not.toContain('ERROR: OpenCode conversation index failed');
    expect(contents).toContain('Claude Code conversation index skipped (path vanished mid-run)');
    expect(contents).toContain('OpenCode conversation index skipped (path vanished mid-run)');
  });

  test('non-Error rejections still log as errors', async () => {
    await updateAllConversationIndexes(async () => ({
      updateClaudeCodeConversations: async () => {
        throw 'bare cc failure';
      },
      updateOpenCodeConversations: async () => ({ newCount: 0, totalCount: 0 }),
    }));
    expect(readLog()).toContain('ERROR: Claude Code conversation index failed: bare cc failure');
  });
});

const noopIndexing = async () => {};
const flush = () => new Promise<void>((r) => setTimeout(r, 40));

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

function detachSignalHandlers() {
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.removeAllListeners(sig);
  }
  process.removeAllListeners('unhandledRejection');
  process.removeAllListeners('uncaughtException');
}

describe('MacrodataLocalDaemon', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never);
  });

  afterEach(() => {
    detachSignalHandlers();
  });

  test('start writes a PID + heartbeat file and boots watchers', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();

    expect(existsSync(getPidFile())).toBe(true);
    expect(readFileSync(getPidFile(), 'utf-8')).toBe(process.pid.toString());
    expect(existsSync(getHeartbeatFile())).toBe(true);
    expect(readLog()).toContain('Daemon running');
    expect(d.running).toBe(true);

    d.shutdown('SIGTERM');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(d.running).toBe(false);
  });

  test('start exits when a live daemon already owns the PID file', async () => {
    // A live PID makes the daemon's process.kill(pid,0) liveness probe succeed.
    writeFileSync(getPidFile(), process.pid.toString());
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    expect(readLog()).toContain('already running');
    expect(exitSpy).toHaveBeenCalledWith(0);
    detachSignalHandlers();
  });

  test('start clears a stale PID file and continues', async () => {
    // An unowned PID makes the liveness probe throw, so it is treated as stale.
    writeFileSync(getPidFile(), '2147483646');
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    expect(readLog()).toContain('Removing stale PID file');
    expect(readFileSync(getPidFile(), 'utf-8')).toBe(process.pid.toString());
    d.shutdown('SIGTERM');
  });

  test('start wires SIGHUP to reload and SIGTERM/SIGINT to shutdown', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();

    process.emit('SIGHUP');
    expect(readLog()).toContain('Reloading config (SIGHUP)');

    process.emit('SIGINT');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(readLog()).toContain('Shutting down (SIGINT)');

    // SIGTERM handler path (exit is mocked so the process survives the test).
    process.emit('SIGTERM');
    expect(readLog()).toContain('Shutting down (SIGTERM)');
  });

  test('start installs process-level error handlers that log without crashing', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();

    process.emit('unhandledRejection', new Error('stray reject'), Promise.resolve());
    process.emit('uncaughtException', new Error('stray throw'));
    // A thrown value without a .stack falls back to stringifying the value.
    process.emit('uncaughtException', 'bare string failure' as unknown as Error);

    const contents = readLog();
    expect(contents).toContain('Unhandled rejection (daemon continues)');
    expect(contents).toContain('Uncaught exception (daemon continues): Error: stray throw');
    expect(contents).toContain('Uncaught exception (daemon continues): bare string failure');
    d.shutdown('SIGTERM');
  });

  test('shutdown defers exit until in-flight background indexing settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const d = new MacrodataLocalDaemon({ backgroundIndexing: () => gate });
    await d.start();

    d.shutdown('SIGTERM');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(readLog()).toContain('waiting for background indexing');

    release();
    await flush();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('shutdown stops waiting after the bounded indexing wait elapses', async () => {
    const d = new MacrodataLocalDaemon({
      backgroundIndexing: () => new Promise<void>(() => {}),
      shutdownIndexingWaitMs: 25,
    });
    await d.start();

    d.shutdown('SIGTERM');
    expect(exitSpy).not.toHaveBeenCalled();

    await new Promise((r) => setTimeout(r, 100));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('start logs when background indexing rejects', async () => {
    const d = new MacrodataLocalDaemon({
      backgroundIndexing: async () => {
        throw new Error('preload boom');
      },
    });
    await d.start();
    await flush();
    expect(readLog()).toContain('Failed to preload/index');
    d.shutdown('SIGTERM');
  });

  test('start logs a heartbeat write failure without crashing', async () => {
    // A directory at the heartbeat path makes writeFileSync throw on every beat.
    mkdirSync(getHeartbeatFile(), { recursive: true });
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    expect(readLog()).toContain('Heartbeat write failed');
    d.shutdown('SIGTERM');
  });

  test('the reminders watcher logs errors', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    d.remindersWatcher?.emit('error', new Error('watch exploded'));
    expect(readLog()).toContain('Reminders watcher error');
    d.shutdown('SIGTERM');
  });

  test('the reminders watcher ignores non-json add/change/unlink events', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    const w = d.remindersWatcher!;
    const before = readLog().length;
    w.emit('add', join(ctx.remindersDir, 'x.txt'));
    w.emit('change', join(ctx.remindersDir, 'x.txt'));
    w.emit('unlink', join(ctx.remindersDir, 'x.txt'));
    expect(readLog().slice(before)).toBe('');
    d.shutdown('SIGTERM');
  });

  test('unlinking a reminder stops its running cron job', async () => {
    addReminder(ctx, 'live-job', {
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    expect(d.jobCount).toBe(1);
    d.remindersWatcher!.emit('unlink', join(ctx.remindersDir, 'live-job.json'));
    expect(d.jobCount).toBe(0);
    expect(readLog()).toContain('Stopped job: live-job');
    d.shutdown('SIGTERM');
  });

  test('unlinking a reminder with no active job just logs the removal', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    expect(d.jobCount).toBe(0);
    d.remindersWatcher!.emit('unlink', join(ctx.remindersDir, 'ghost.json'));
    expect(readLog()).toContain('Reminder removed: ghost');
    expect(readLog()).not.toContain('Stopped job: ghost');
    d.shutdown('SIGTERM');
  });

  test('loadAndStartSchedules starts cron jobs and drops expired one-shots', () => {
    addReminder(ctx, 'cron-1', {
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    addReminder(ctx, 'past-1', {
      type: 'once',
      expression: '2000-01-01T00:00:00.000Z',
      description: 'expired',
      payload: 'p',
    });
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.loadAndStartSchedules();
    expect(d.jobCount).toBe(1);
    expect(existsSync(join(ctx.remindersDir, 'past-1.json'))).toBe(false);
    expect(readLog()).toContain('Started cron job: cron-1');
    d.shutdown('SIGTERM');
  });

  test('loadAndStartSchedules ignores a schedule with an unknown type', () => {
    writeFileSync(
      join(ctx.remindersDir, 'weird.json'),
      JSON.stringify({
        id: 'weird',
        type: 'weekly',
        expression: 'whatever',
        description: 'd',
        payload: 'p',
        createdAt: new Date().toISOString(),
      }),
    );
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.loadAndStartSchedules();
    expect(d.jobCount).toBe(0);
    d.shutdown('SIGTERM');
  });

  test('startOnceJob schedules a future one-shot', () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    addReminder(ctx, 'future-1', {
      type: 'once',
      expression: future,
      description: 'd',
      payload: 'p',
    });
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.loadAndStartSchedules();
    expect(d.jobCount).toBe(1);
    expect(readLog()).toContain('Scheduled one-shot: future-1');
    d.shutdown('SIGTERM');
  });

  test('startCronJob logs a failure for an invalid expression', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.addSchedule({
      id: 'bad-cron',
      type: 'cron',
      expression: 'not a cron',
      description: 'd',
      payload: 'p',
      createdAt: new Date().toISOString(),
    });
    expect(readLog()).toContain('Failed to start cron job bad-cron');
    d.shutdown('SIGTERM');
  });

  test('startOnceJob logs a failure for an invalid datetime', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.addSchedule({
      id: 'bad-once',
      type: 'once',
      expression: 'not-a-date',
      description: 'd',
      payload: 'p',
      createdAt: new Date().toISOString(),
    });
    expect(readLog()).toContain('Failed to schedule one-shot bad-once');
    d.shutdown('SIGTERM');
  });

  test('fireSchedule triggers the configured agent', async () => {
    execSyncMock.mockReturnValue('/bin/opencode\n');
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.fireSchedule({
      id: 'fire-1',
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'go',
      agent: 'opencode',
      createdAt: new Date().toISOString(),
    });
    expect(spawnMock).toHaveBeenCalled();
    expect(readLog()).toContain('Successfully triggered opencode for: fire-1');
  });

  test('fireSchedule logs a trigger failure', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('no spawn');
    });
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.fireSchedule({
      id: 'fire-2',
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'go',
      agent: 'claude',
      createdAt: new Date().toISOString(),
    });
    expect(readLog()).toContain('Failed to trigger claude for: fire-2');
  });

  test('fireSchedule notes when no agent is configured', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.fireSchedule({
      id: 'fire-3',
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'go',
      createdAt: new Date().toISOString(),
    });
    expect(readLog()).toContain('No agent specified for: fire-3');
  });

  test('reloadSchedules starts new jobs, drops expired, and stops removed', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    addReminder(ctx, 'keep', {
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    d.reloadSchedules();
    expect(d.jobCount).toBe(1);

    d.reloadSchedules();
    expect(d.jobCount).toBe(1);

    addReminder(ctx, 'gone-once', {
      type: 'once',
      expression: '2000-01-01T00:00:00.000Z',
      description: 'd',
      payload: 'p',
    });
    d.reloadSchedules();
    expect(existsSync(join(ctx.remindersDir, 'gone-once.json'))).toBe(false);

    rmSync(join(ctx.remindersDir, 'keep.json'));
    d.reloadSchedules();
    expect(d.jobCount).toBe(0);
    expect(readLog()).toContain('Stopped removed job: keep');
    d.shutdown('SIGTERM');
  });

  test('reloadSchedules schedules a future one-shot', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    addReminder(ctx, 'future-once', {
      type: 'once',
      expression: new Date(Date.now() + 60 * 60_000).toISOString(),
      description: 'd',
      payload: 'p',
    });
    d.reloadSchedules();
    expect(d.jobCount).toBe(1);
    expect(readLog()).toContain('Scheduled one-shot: future-once');
    d.shutdown('SIGTERM');
  });

  test('a per-second cron job fires its agent', async () => {
    execSyncMock.mockReturnValue('/bin/opencode\n');
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.addSchedule({
      id: 'tick',
      type: 'cron',
      expression: '* * * * * *',
      description: 'd',
      payload: 'go',
      agent: 'opencode',
      createdAt: new Date().toISOString(),
    });
    await waitFor(() => readLog().includes('Firing schedule: tick'), 4000);
    expect(readLog()).toContain('Firing schedule: tick');
    d.shutdown('SIGTERM');
  });

  test('queueReindex debounces rapid successive queues', async () => {
    const indexed: string[] = [];
    const d = new MacrodataLocalDaemon({
      backgroundIndexing: noopIndexing,
      indexerLoader: async () => ({
        indexEntityFile: async (p: string) => {
          indexed.push(p);
        },
      }),
    });
    const a = join(ctx.entitiesDir, 'projects', 'd-a.md');
    const b = join(ctx.entitiesDir, 'projects', 'd-b.md');
    writeFileSync(a, '# A');
    writeFileSync(b, '# B');
    d.queueReindex(a);
    d.queueReindex(b);
    await waitFor(() => indexed.length === 2, 4000);
    expect(indexed).toContain(a);
    expect(indexed).toContain(b);
    d.shutdown('SIGTERM');
  });

  test('reload works before start when no watchers exist yet', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.reload();
    expect(readLog()).toContain('Reload complete');
    d.shutdown('SIGTERM');
  });

  test('shutdown before start leaves a foreign PID file untouched', () => {
    writeFileSync(getPidFile(), '999999');
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.shutdown('SIGTERM');
    expect(existsSync(getPidFile())).toBe(true);
    expect(readFileSync(getPidFile(), 'utf-8')).toBe('999999');
  });

  test('shutdown is safe when no PID file exists', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    expect(existsSync(getPidFile())).toBe(false);
    expect(() => d.shutdown('SIGINT')).not.toThrow();
  });

  test('reload stops previously running jobs', async () => {
    addReminder(ctx, 'pre-reload', {
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    expect(d.jobCount).toBe(1);
    d.reload();
    expect(readLog()).toContain('Reload complete');
    d.shutdown('SIGTERM');
  });

  test('removeSchedule stops the job and deletes the file', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    d.addSchedule({
      id: 'rm-1',
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'p',
      createdAt: new Date().toISOString(),
    });
    expect(d.jobCount).toBe(1);
    d.removeSchedule('rm-1');
    expect(d.jobCount).toBe(0);
    expect(existsSync(join(ctx.remindersDir, 'rm-1.json'))).toBe(false);
    d.shutdown('SIGTERM');
  });

  test('processReindexQueue indexes queued entity files', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.processReindexQueue();

    const good = join(ctx.entitiesDir, 'projects', 'alpha.md');
    writeFileSync(good, '# Alpha\n\n## X\n\nbody');
    d.queueReindex(good);
    await d.processReindexQueue();

    const contents = readLog();
    expect(contents).toContain('Reindexing 1 file(s)');
    expect(contents).toContain('✓ alpha.md');
    d.shutdown('SIGTERM');
  });

  test('processReindexQueue reports a per-file indexing failure', async () => {
    const d = new MacrodataLocalDaemon({
      backgroundIndexing: noopIndexing,
      indexerLoader: async () => ({
        indexEntityFile: async () => {
          throw new Error('index boom');
        },
      }),
    });
    const p = join(ctx.entitiesDir, 'projects', 'broken.md');
    writeFileSync(p, '# Broken\n\n## X\n\nbody');
    d.queueReindex(p);
    await d.processReindexQueue();
    expect(readLog()).toContain('✗ broken.md: Error: index boom');
    d.shutdown('SIGTERM');
  });

  test('a future one-shot fires its agent then auto-removes itself', async () => {
    execSyncMock.mockReturnValue('/bin/opencode\n');
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    const fireAt = new Date(Date.now() + 900).toISOString();
    d.addSchedule({
      id: 'once-fires',
      type: 'once',
      expression: fireAt,
      description: 'd',
      payload: 'go',
      agent: 'opencode',
      createdAt: new Date().toISOString(),
    });
    expect(d.jobCount).toBe(1);

    await waitFor(() => readLog().includes('Firing schedule: once-fires'), 5000);
    expect(readLog()).toContain('Firing schedule: once-fires');
    expect(d.jobCount).toBe(0);
    d.shutdown('SIGTERM');
  });

  test('onWatchedFileEvent ignores non-md, non-add/change, and unwatched paths', () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });

    d.onWatchedFileEvent('add', join(ctx.stateDir, 'note.txt'));
    d.onWatchedFileEvent('unlink', join(ctx.stateDir, 'today.md'));
    expect(readLog()).not.toContain('File ');

    // A watched .md outside both state and entities logs but writes no context.
    d.onWatchedFileEvent('add', join(ctx.root, 'elsewhere', 'stray.md'));
    expect(readLog()).toContain('File add');
    expect(existsSync(getPendingContext())).toBe(false);
  });

  test('reload restarts watchers and schedules', async () => {
    const d = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await d.start();
    await flush();
    addReminder(ctx, 'after-reload', {
      type: 'cron',
      expression: '0 9 * * *',
      description: 'd',
      payload: 'p',
    });
    d.reload();
    expect(d.jobCount).toBe(1);
    expect(readLog()).toContain('Reload complete');
    d.shutdown('SIGTERM');
  });
});

describe('MacrodataLocalDaemon watchers', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let daemon: InstanceType<typeof MacrodataLocalDaemon> | null;

  const waitForLog = async (needle: string, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (readLog().includes(needle)) return true;
      await new Promise((r) => setTimeout(r, 60));
    }
    return readLog().includes(needle);
  };

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never);
    daemon = null;
  });

  afterEach(() => {
    if (daemon) daemon.shutdown('SIGTERM');
    detachSignalHandlers();
    exitSpy.mockRestore();
  });

  test('detects a reminder file added at runtime', async () => {
    daemon = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await daemon.start();
    await new Promise((r) => setTimeout(r, 300));

    addReminder(ctx, 'runtime-add', {
      type: 'cron',
      expression: '0 12 * * *',
      description: 'runtime',
      payload: 'p',
    });

    expect(await waitForLog('Reminder added: runtime-add.json')).toBe(true);
    expect(readFileSync(getPendingContext(), 'utf-8')).toContain('schedule-added');
  });

  test('detects a reminder change and removal at runtime', async () => {
    addReminder(ctx, 'runtime-edit', {
      type: 'cron',
      expression: '0 9 * * *',
      description: 'orig',
      payload: 'p',
    });
    daemon = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await daemon.start();
    await new Promise((r) => setTimeout(r, 300));

    writeFileSync(
      join(ctx.remindersDir, 'runtime-edit.json'),
      JSON.stringify({
        id: 'runtime-edit',
        type: 'cron',
        expression: '0 10 * * *',
        description: 'changed',
        payload: 'p',
        agent: 'claude',
        createdAt: new Date().toISOString(),
      }),
    );
    expect(await waitForLog('Reminder changed: runtime-edit.json')).toBe(true);

    rmSync(join(ctx.remindersDir, 'runtime-edit.json'));
    expect(await waitForLog('Reminder removed: runtime-edit')).toBe(true);
  });

  test('ignores non-json reminder writes and tolerates malformed json', async () => {
    daemon = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await daemon.start();
    await new Promise((r) => setTimeout(r, 300));

    // Non-json files in the reminders dir are ignored by every watcher branch.
    writeFileSync(join(ctx.remindersDir, 'notes.txt'), 'not a reminder');
    // Malformed json still logs the add but skips the pending-context write.
    writeFileSync(join(ctx.remindersDir, 'broken.json'), '{ oops');

    expect(await waitForLog('Reminder added: broken.json')).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(readLog()).not.toContain('Reminder added: notes.txt');

    // Overwriting the malformed file exercises the change handler's catch too.
    writeFileSync(join(ctx.remindersDir, 'broken.json'), '{ still bad');
    expect(await waitForLog('Reminder changed: broken.json')).toBe(true);

    // Changing then removing a non-json file hits the change/unlink json guards.
    writeFileSync(join(ctx.remindersDir, 'notes.txt'), 'edited');
    await new Promise((r) => setTimeout(r, 200));
    rmSync(join(ctx.remindersDir, 'notes.txt'));
    await new Promise((r) => setTimeout(r, 300));
    expect(readLog()).not.toContain('Reminder removed: notes');
  });

  test('injects capped state-file context and reindexes entity files', async () => {
    daemon = new MacrodataLocalDaemon({ backgroundIndexing: noopIndexing });
    await daemon.start();
    await new Promise((r) => setTimeout(r, 300));

    writeFileSync(join(ctx.stateDir, 'today.md'), 'x'.repeat(5000));
    expect(await waitForLog('today.md')).toBe(true);
    expect(readFileSync(getPendingContext(), 'utf-8')).toContain('truncated');

    // A small state file is injected verbatim (under the cap, no truncation).
    writeFileSync(join(ctx.stateDir, 'human.md'), 'short human note');
    expect(await waitForLog('human.md')).toBe(true);
    expect(readFileSync(getPendingContext(), 'utf-8')).toContain('short human note');

    writeFileSync(join(ctx.stateDir, 'ignore.txt'), 'nope');

    writeFileSync(join(ctx.entitiesDir, 'projects', 'beta.md'), '# Beta\n\n## S\n\nbody');
    expect(await waitForLog('beta.md')).toBe(true);
    expect(readFileSync(getPendingContext(), 'utf-8')).toContain('type="entity"');

    // A non add/change event (unlink) on a watched .md file is ignored.
    const logBefore = readLog().length;
    rmSync(join(ctx.entitiesDir, 'projects', 'beta.md'));
    await new Promise((r) => setTimeout(r, 400));
    expect(readLog().slice(logBefore)).not.toContain('File unlink');
  }, 20000);
});

describe('runDaemon', () => {
  test('constructs and starts a daemon instance, forwarding injected options', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never);
    // Injecting a noop indexer here is load-bearing: without it, runDaemon()
    // starts REAL background indexing under the test temp root, which races
    // with cleanup() and pollutes the production daemon log (#31).
    const indexingRan = vi.fn(async () => {});
    const d = runDaemon({ backgroundIndexing: indexingRan });
    await flush();
    expect(d).toBeInstanceOf(MacrodataLocalDaemon);
    expect(existsSync(getPidFile())).toBe(true);
    expect(indexingRan).toHaveBeenCalled();
    d.shutdown('SIGTERM');
    detachSignalHandlers();
    exitSpy.mockRestore();
  });

  test('logs a fatal error and exits when start rejects', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((): never => undefined as never);
    const startSpy = vi
      .spyOn(MacrodataLocalDaemon.prototype, 'start')
      .mockRejectedValue(new Error('start blew up'));
    runDaemon();
    await flush();
    expect(readLog()).toContain('Fatal error: Error: start blew up');
    expect(exitSpy).toHaveBeenCalledWith(1);
    startSpy.mockRestore();
    detachSignalHandlers();
    exitSpy.mockRestore();
  });
});
