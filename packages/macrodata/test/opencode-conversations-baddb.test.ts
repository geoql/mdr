/**
 * Covers openDb's open-failure catch: MACRODATA_OPENCODE_DB_PATH points at a
 * path that exists but cannot be opened as a SQLite database (a directory),
 * so DatabaseSync throws and openDb returns null.
 */

import { describe, test, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const stateRoot = mkdtempSync(join(tmpdir(), 'macrodata-ocbaddb-state-'));
mkdirSync(join(stateRoot, '.index'), { recursive: true });
// A directory at the db path exists() but fails to open as a database.
const badDbDir = mkdtempSync(join(tmpdir(), 'macrodata-ocbaddb-'));
process.env.MACRODATA_ROOT = stateRoot;
process.env.MACRODATA_OPENCODE_DB_PATH = badDbDir;

const oc = await import('../opencode/conversations');

describe('openDb open failure', () => {
  test('rebuild returns 0 when the database cannot be opened', async () => {
    const result = await oc.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
  });

  test('update returns zero counts when the database cannot be opened', async () => {
    const result = await oc.updateConversationIndex();
    expect(result).toEqual({ newCount: 0, totalCount: 0 });
  });
});
