/**
 * Tests for getStateRoot's config-file fallback path.
 *
 * os.homedir is redirected to a temp directory so the ~/.config/macrodata
 * default-root and config.json branches are exercised without ever touching
 * the real user config.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const fakeHome = mkdtempSync(join(tmpdir(), 'macrodata-home-'));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => fakeHome };
});

const { getStateRoot } = await import('../src/config');

const defaultRoot = join(fakeHome, '.config', 'macrodata');
const configPath = join(defaultRoot, 'config.json');
let prevEnv: string | undefined;

beforeEach(() => {
  prevEnv = process.env.MACRODATA_ROOT;
  delete process.env.MACRODATA_ROOT;
  mkdirSync(defaultRoot, { recursive: true });
});

afterEach(() => {
  if (existsSync(configPath)) rmSync(configPath);
  if (prevEnv === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevEnv;
});

describe('getStateRoot config-file fallback', () => {
  test('falls back to the default root when no config.json exists', () => {
    expect(getStateRoot()).toBe(defaultRoot);
  });

  test('uses config.json root when present', () => {
    writeFileSync(configPath, JSON.stringify({ root: '/custom/state/root' }));
    expect(getStateRoot()).toBe('/custom/state/root');
  });

  test('ignores a config.json without a root field', () => {
    writeFileSync(configPath, JSON.stringify({ somethingElse: true }));
    expect(getStateRoot()).toBe(defaultRoot);
  });

  test('ignores a malformed config.json', () => {
    writeFileSync(configPath, '{ not valid json');
    expect(getStateRoot()).toBe(defaultRoot);
  });

  test('MACRODATA_ROOT still overrides the config file', () => {
    writeFileSync(configPath, JSON.stringify({ root: '/custom' }));
    process.env.MACRODATA_ROOT = '/env/override';
    expect(getStateRoot()).toBe('/env/override');
  });
});
