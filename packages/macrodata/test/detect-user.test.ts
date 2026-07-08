/**
 * Tests for detectUser(), mocking the process/fs/os boundaries so every
 * system-probe branch is exercised deterministically.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

const execSyncMock = vi.fn();
const existsSyncMock = vi.fn();
const homedirMock = vi.fn();

vi.mock('child_process', () => ({ execSync: (cmd: string) => execSyncMock(cmd) }));
vi.mock('fs', () => ({ existsSync: (p: string) => existsSyncMock(p) }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => homedirMock() };
});

const { detectUser } = await import('../src/detect-user');

/** Route exec() output by matching the command string. */
function routeExec(routes: Array<[RegExp | string, string]>, throwOn: RegExp[] = []) {
  execSyncMock.mockImplementation((cmd: string) => {
    if (throwOn.some((re) => re.test(cmd))) throw new Error('command failed');
    for (const [match, out] of routes) {
      if (typeof match === 'string' ? cmd === match : match.test(cmd)) return out;
    }
    return '';
  });
}

beforeEach(() => {
  execSyncMock.mockReset();
  existsSyncMock.mockReset();
  homedirMock.mockReset();
  homedirMock.mockReturnValue('/home/tester');
  existsSyncMock.mockReturnValue(false);
});

describe('detectUser', () => {
  test('collects git, github, timezone and code dirs on the happy path', () => {
    routeExec([
      [/^whoami/, 'alice'],
      [/^id -F/, 'Alice Example'],
      [/user\.name/, 'Alice'],
      [/user\.email/, 'alice@example.com'],
      [/command -v gh/, '/usr/bin/gh'],
      [/gh api user/, JSON.stringify({ login: 'alicehub', name: 'Alice E', blog: 'b', bio: 'hi' })],
      [/etc\/timezone/, 'Europe/Berlin'],
    ]);
    existsSyncMock.mockImplementation((p: string) => p === '/etc/timezone' || p.endsWith('/dev'));

    const info = detectUser();
    expect(info.username).toBe('alice');
    expect(info.fullName).toBe('Alice Example');
    expect(info.timezone).toBe('Europe/Berlin');
    expect(info.git).toEqual({ name: 'Alice', email: 'alice@example.com' });
    expect(info.github.login).toBe('alicehub');
    expect(info.codeDirs).toEqual(['/home/tester/dev']);
  });

  test('falls back to getent when id -F yields nothing', () => {
    routeExec([
      [/^whoami/, 'bob'],
      [/getent passwd/, 'Bob Fallback'],
    ]);
    const info = detectUser();
    expect(info.fullName).toBe('Bob Fallback');
  });

  test('reads timezone from /etc/localtime when /etc/timezone is absent', () => {
    routeExec([
      [/^whoami/, 'carol'],
      [/readlink \/etc\/localtime/, 'America/New_York'],
    ]);
    existsSyncMock.mockImplementation((p: string) => p === '/etc/localtime');
    const info = detectUser();
    expect(info.timezone).toBe('America/New_York');
  });

  test('leaves timezone empty when neither timezone file exists', () => {
    routeExec([[/^whoami/, 'dan']]);
    const info = detectUser();
    expect(info.timezone).toBe('');
  });

  test('skips github lookup when gh is not installed', () => {
    routeExec([[/^whoami/, 'erin']]); // command -v gh returns "" -> no gh
    const info = detectUser();
    expect(info.github).toEqual({});
  });

  test('ignores malformed gh json', () => {
    routeExec([
      [/^whoami/, 'frank'],
      [/command -v gh/, '/usr/bin/gh'],
      [/gh api user/, '{ not json'],
    ]);
    const info = detectUser();
    expect(info.github).toEqual({});
  });

  test('handles gh present but returning no json', () => {
    routeExec([
      [/^whoami/, 'gina'],
      [/command -v gh/, '/usr/bin/gh'],
      // gh api user returns "" -> the inner if is skipped.
    ]);
    const info = detectUser();
    expect(info.github).toEqual({});
  });

  test('exec swallows command failures and returns empty strings', () => {
    routeExec([[/^whoami/, 'hank']], [/id -F/, /getent/]);
    const info = detectUser();
    expect(info.fullName).toBe('');
  });

  test('returns no code dirs when none exist', () => {
    routeExec([[/^whoami/, 'ivy']]);
    existsSyncMock.mockReturnValue(false);
    const info = detectUser();
    expect(info.codeDirs).toEqual([]);
  });
});
