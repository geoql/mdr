/**
 * OpenCode 2 store support for the conversation indexer (#152).
 *
 * OpenCode 2 writes `session_v2` + `session_message` (user text inline in
 * `data.text`, assistant text inline in `data.content[]`). OpenCode 1 writes
 * `session` + `message` + `part`. A V1 store that OpenCode 2 has migrated in
 * place carries BOTH generations, and on this machine the V1 host keeps writing
 * `message`/`part` while the migrated `session_message` copy goes stale — so
 * neither table's presence identifies the host. The reader must union both
 * generations, dedupe by exchange id, and fail closed when neither exists.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import {
  queryExchanges,
  detectStoreGenerations,
  resolveOpenCodeDbPath,
} from '~~/opencode/conversations';

function createV2Db(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, worktree TEXT)`);
  db.exec(`CREATE TABLE session_v2 (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    parent_id TEXT,
    directory TEXT,
    time_created INTEGER
  )`);
  db.exec(`CREATE TABLE session_message (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    type TEXT,
    seq INTEGER,
    time_created INTEGER,
    data TEXT
  )`);
}

function createV1Db(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, worktree TEXT)`);
  db.exec(`CREATE TABLE session (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    parent_id TEXT,
    directory TEXT,
    time_created INTEGER
  )`);
  db.exec(
    `CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)`,
  );
  db.exec(`CREATE TABLE part (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    session_id TEXT,
    time_created INTEGER,
    data TEXT
  )`);
}

interface SeedOpts {
  sessionId: string;
  userMsgId: string;
  assistantMsgId: string;
  timeMs: number;
  userText: string;
  assistantText?: string;
  parentId?: string | null;
  seq?: number;
}

function seedV2(db: DatabaseSync, opts: SeedOpts): void {
  const seq = opts.seq ?? 1;
  db.exec(`INSERT OR IGNORE INTO project (id, worktree) VALUES ('prj_1', '/tmp/proj')`);
  db.prepare(
    `INSERT OR IGNORE INTO session_v2 (id, project_id, parent_id, directory, time_created) VALUES (?, 'prj_1', ?, '/tmp/proj', ?)`,
  ).run(opts.sessionId, opts.parentId ?? null, opts.timeMs);
  db.prepare(
    `INSERT INTO session_message (id, session_id, type, seq, time_created, data) VALUES (?, ?, 'user', ?, ?, ?)`,
  ).run(
    opts.userMsgId,
    opts.sessionId,
    seq,
    opts.timeMs,
    JSON.stringify({ time: { created: opts.timeMs }, text: opts.userText, files: [] }),
  );
  db.prepare(
    `INSERT INTO session_message (id, session_id, type, seq, time_created, data) VALUES (?, ?, 'assistant', ?, ?, ?)`,
  ).run(
    opts.assistantMsgId,
    opts.sessionId,
    seq + 1,
    opts.timeMs + 1000,
    JSON.stringify({
      content: [
        { type: 'reasoning', text: 'thinking...' },
        { type: 'text', text: opts.assistantText ?? 'v2 reply' },
        { type: 'text', text: 'second part' },
      ],
    }),
  );
}

function seedV1(db: DatabaseSync, opts: SeedOpts): void {
  db.exec(`INSERT OR IGNORE INTO project (id, worktree) VALUES ('prj_1', '/tmp/proj')`);
  db.prepare(
    `INSERT OR IGNORE INTO session (id, project_id, parent_id, directory, time_created) VALUES (?, 'prj_1', ?, '/tmp/proj', ?)`,
  ).run(opts.sessionId, opts.parentId ?? null, opts.timeMs);
  db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run(
    opts.userMsgId,
    opts.sessionId,
    opts.timeMs,
    JSON.stringify({ role: 'user' }),
  );
  db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run(
    opts.assistantMsgId,
    opts.sessionId,
    opts.timeMs + 1000,
    JSON.stringify({ role: 'assistant' }),
  );
  db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    `${opts.userMsgId}-p`,
    opts.userMsgId,
    opts.sessionId,
    opts.timeMs,
    JSON.stringify({ type: 'text', text: opts.userText }),
  );
  db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    `${opts.assistantMsgId}-p`,
    opts.assistantMsgId,
    opts.sessionId,
    opts.timeMs + 1000,
    JSON.stringify({ type: 'text', text: opts.assistantText ?? 'v1 reply' }),
  );
}

describe('detectStoreGenerations', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  test('reports a pure V2 store', () => {
    createV2Db(db);
    expect(detectStoreGenerations(db)).toEqual({ v1: false, v2: true });
  });

  test('reports a pure V1 store', () => {
    createV1Db(db);
    expect(detectStoreGenerations(db)).toEqual({ v1: true, v2: false });
  });

  test('reports both generations on a migrated store', () => {
    createV1Db(db);
    createV2Db(db);
    expect(detectStoreGenerations(db)).toEqual({ v1: true, v2: true });
  });

  test('reports neither on an unrelated database', () => {
    db.exec(`CREATE TABLE kv (k TEXT, v TEXT)`);
    expect(detectStoreGenerations(db)).toEqual({ v1: false, v2: false });
  });
});

describe('queryExchanges on an OpenCode 2 store', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    createV2Db(db);
  });

  afterEach(() => {
    db.close();
  });

  test('reads user text and concatenates assistant text parts', () => {
    seedV2(db, {
      sessionId: 'ses_v2',
      userMsgId: 'msg_u1',
      assistantMsgId: 'msg_a1',
      timeMs: 1000,
      userText: 'hello v2',
      assistantText: 'reply v2',
    });

    const rows = queryExchanges(db);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_msg_id: 'msg_u1',
      session_id: 'ses_v2',
      user_time: 1000,
      user_text: 'hello v2',
      assistant_text: 'reply v2\nsecond part',
      worktree: '/tmp/proj',
      directory: '/tmp/proj',
    });
  });

  test('pairs each user message with the next assistant message by seq', () => {
    seedV2(db, {
      sessionId: 'ses_v2',
      userMsgId: 'msg_u1',
      assistantMsgId: 'msg_a1',
      timeMs: 1000,
      userText: 'first',
      assistantText: 'answer one',
      seq: 1,
    });
    seedV2(db, {
      sessionId: 'ses_v2',
      userMsgId: 'msg_u2',
      assistantMsgId: 'msg_a2',
      timeMs: 5000,
      userText: 'second',
      assistantText: 'answer two',
      seq: 3,
    });

    const rows = queryExchanges(db);

    expect(rows.map((r) => [r.user_text, r.assistant_text])).toEqual([
      ['first', 'answer one\nsecond part'],
      ['second', 'answer two\nsecond part'],
    ]);
  });

  test('applies the sinceMs filter', () => {
    seedV2(db, {
      sessionId: 'ses_v2',
      userMsgId: 'msg_u1',
      assistantMsgId: 'msg_a1',
      timeMs: 1000,
      userText: 'old',
      seq: 1,
    });
    seedV2(db, {
      sessionId: 'ses_v2',
      userMsgId: 'msg_u2',
      assistantMsgId: 'msg_a2',
      timeMs: 5000,
      userText: 'new',
      seq: 3,
    });

    expect(queryExchanges(db, 2000).map((r) => r.user_text)).toEqual(['new']);
  });

  test('skips subtask sessions and unanswered or empty prompts', () => {
    seedV2(db, {
      sessionId: 'ses_child',
      userMsgId: 'msg_c1',
      assistantMsgId: 'msg_ca1',
      timeMs: 1000,
      userText: 'child prompt',
      parentId: 'ses_parent',
    });
    db.prepare(
      `INSERT INTO session_message (id, session_id, type, seq, time_created, data) VALUES (?, ?, 'user', ?, ?, ?)`,
    ).run('msg_lonely', 'ses_child', 9, 9000, JSON.stringify({ text: 'never answered' }));
    seedV2(db, {
      sessionId: 'ses_top',
      userMsgId: 'msg_e1',
      assistantMsgId: 'msg_ea1',
      timeMs: 2000,
      userText: '',
    });

    expect(queryExchanges(db)).toEqual([]);
  });
});

describe('queryExchanges on a migrated (dual-generation) store', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    createV1Db(db);
    createV2Db(db);
  });

  afterEach(() => {
    db.close();
  });

  test('unions both generations, dedupes shared ids, and orders by time', () => {
    // Shared history copied by the in-place migration: same ids in both.
    seedV1(db, {
      sessionId: 'ses_shared',
      userMsgId: 'msg_s1',
      assistantMsgId: 'msg_sa1',
      timeMs: 1000,
      userText: 'shared prompt',
      assistantText: 'v1 text',
    });
    seedV2(db, {
      sessionId: 'ses_shared',
      userMsgId: 'msg_s1',
      assistantMsgId: 'msg_sa1',
      timeMs: 1000,
      userText: 'shared prompt',
      assistantText: 'v2 text',
    });
    // Newer V1-only turn (V1 host kept writing after the migration).
    seedV1(db, {
      sessionId: 'ses_shared',
      userMsgId: 'msg_v1only',
      assistantMsgId: 'msg_v1a',
      timeMs: 3000,
      userText: 'v1 only',
    });
    // Newer V2-only turn.
    seedV2(db, {
      sessionId: 'ses_v2only',
      userMsgId: 'msg_v2only',
      assistantMsgId: 'msg_v2a',
      timeMs: 2000,
      userText: 'v2 only',
    });

    const rows = queryExchanges(db);

    expect(rows.map((r) => r.user_msg_id)).toEqual(['msg_s1', 'msg_v2only', 'msg_v1only']);
    // The V1 row wins for a shared id so already-indexed text is unchanged.
    expect(rows[0].assistant_text).toBe('v1 text');
  });
});

describe('queryExchanges fails closed', () => {
  test('propagates a query failure on a detected generation (#25)', () => {
    const db = new DatabaseSync(':memory:');
    // V2 tables exist but session_message lacks the columns the reader needs.
    db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT)`);
    db.exec(`CREATE TABLE session_v2 (id TEXT PRIMARY KEY)`);
    db.exec(`CREATE TABLE session_message (id TEXT PRIMARY KEY)`);
    try {
      expect(() => queryExchanges(db)).toThrow(/no such column/);
    } finally {
      db.close();
    }
  });

  test('throws with a clear message when neither generation exists', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE kv (k TEXT, v TEXT)`);
    try {
      expect(() => queryExchanges(db)).toThrow(/neither .*session_message.* nor .*message.*part/);
    } finally {
      db.close();
    }
  });
});

describe('resolveOpenCodeDbPath', () => {
  const dataDir = join('/home', 'u', '.local', 'share', 'opencode');

  test('explicit MACRODATA_OPENCODE_DB_PATH wins', () => {
    expect(
      resolveOpenCodeDbPath(
        { MACRODATA_OPENCODE_DB_PATH: '/x/custom.db', OPENCODE_DB: 'opencode2.db' },
        dataDir,
      ),
    ).toBe('/x/custom.db');
  });

  test('OPENCODE_DB relative to the data dir (opencode2 wrapper)', () => {
    expect(resolveOpenCodeDbPath({ OPENCODE_DB: 'opencode2.db' }, dataDir)).toBe(
      join(dataDir, 'opencode2.db'),
    );
  });

  test('OPENCODE_DB absolute path is used as-is', () => {
    expect(resolveOpenCodeDbPath({ OPENCODE_DB: '/abs/store.db' }, dataDir)).toBe('/abs/store.db');
  });

  test('defaults to opencode.db', () => {
    expect(resolveOpenCodeDbPath({}, dataDir)).toBe(join(dataDir, 'opencode.db'));
  });
});
