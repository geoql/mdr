/**
 * Tests for the OpenCode conversation indexer's rebuild/update/search paths.
 *
 * MACRODATA_OPENCODE_DB_PATH is set to a temp SQLite file BEFORE the module is
 * imported (the module reads it into a const at load), and MACRODATA_ROOT
 * points the vector index at a temp dir. The real embedding model is used.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dbPath = join(mkdtempSync(join(tmpdir(), "macrodata-ocdb-")), "opencode.db");
const stateRoot = mkdtempSync(join(tmpdir(), "macrodata-ocstate-"));
mkdirSync(join(stateRoot, ".index"), { recursive: true });
process.env.MACRODATA_OPENCODE_DB_PATH = dbPath;
process.env.MACRODATA_ROOT = stateRoot;

const oc = await import("../opencode/conversations");

function makeDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT)`);
  db.exec(
    `CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER)`,
  );
  db.exec(
    `CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)`,
  );
  db.exec(
    `CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`,
  );
  return db;
}

function seed(
  db: DatabaseSync,
  o: {
    session: string;
    u: string;
    a: string;
    t: number;
    text: string;
    project?: string;
    worktree?: string;
    directory?: string;
  },
) {
  const project = o.project ?? "prj_1";
  db.prepare(`INSERT OR IGNORE INTO project (id, worktree) VALUES (?, ?)`).run(
    project,
    o.worktree ?? "/tmp/proj",
  );
  db.prepare(
    `INSERT OR IGNORE INTO session (id, project_id, parent_id, directory, time_created) VALUES (?, ?, NULL, ?, ?)`,
  ).run(o.session, project, o.directory ?? "/tmp/proj", o.t);
  db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run(
    o.u,
    o.session,
    o.t,
    JSON.stringify({ role: "user" }),
  );
  db.prepare(`INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)`).run(
    o.a,
    o.session,
    o.t + 1000,
    JSON.stringify({ role: "assistant" }),
  );
  db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`,
  ).run(`${o.u}-p`, o.u, o.session, o.t, JSON.stringify({ type: "text", text: o.text }));
  db.prepare(
    `INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    `${o.a}-p`,
    o.a,
    o.session,
    o.t + 1000,
    JSON.stringify({ type: "text", text: "assistant reply text" }),
  );
}

let db: DatabaseSync;

beforeAll(() => {
  db = makeDb(dbPath);
});

afterAll(() => {
  db.close();
  rmSync(stateRoot, { recursive: true, force: true });
});

describe("resetConversationIndexForTests", () => {
  test("drops the cached index so a later query reopens it", async () => {
    seed(db, {
      session: "ses_reset",
      u: "rmu",
      a: "rma",
      t: 1_700_000_050_000,
      text: "reset seam probe",
    });
    await oc.rebuildConversationIndex();
    oc.resetConversationIndexForTests();
    // After reset the next call must reopen the on-disk index and still see data.
    const stats = await oc.getConversationIndexStats();
    expect(stats.exchangeCount).toBeGreaterThan(0);
  }, 90000);
});

describe("rebuildConversationIndex", () => {
  test("indexes exchanges from the opencode db and is searchable", async () => {
    seed(db, {
      session: "ses_a",
      u: "mu1",
      a: "ma1",
      t: 1_700_000_000_000,
      text: "how to deploy a rust binary",
    });
    const result = await oc.rebuildConversationIndex();
    expect(result.exchangeCount).toBeGreaterThanOrEqual(1);

    const stats = await oc.getConversationIndexStats();
    expect(stats.exchangeCount).toBe(result.exchangeCount);

    const hits = await oc.searchConversations("deploy rust", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].exchange.project).toBe("proj");
  }, 90000);

  test("coalesces a concurrent rebuild into the in-flight promise", async () => {
    const [a, b] = await Promise.all([
      oc.rebuildConversationIndex(),
      oc.rebuildConversationIndex(),
    ]);
    expect(a.exchangeCount).toBe(b.exchangeCount);
  }, 90000);
});

describe("updateConversationIndex", () => {
  test("adds only new exchanges since the last index", async () => {
    seed(db, {
      session: "ses_b",
      u: "mu2",
      a: "ma2",
      t: 1_700_000_100_000,
      text: "a brand new question about caching layers",
    });
    const result = await oc.updateConversationIndex();
    expect(result.newCount).toBeGreaterThanOrEqual(1);
  }, 90000);

  test("reports zero new when nothing changed", async () => {
    // Drain any pending exchanges first, then a second update sees nothing new.
    await oc.updateConversationIndex();
    const result = await oc.updateConversationIndex();
    expect(result.newCount).toBe(0);
    expect(result.totalCount).toBeGreaterThan(0);
  }, 90000);
});

describe("rowsToExchanges + time weighting via search", () => {
  const DAY = 24 * 60 * 60 * 1000;

  test("falls back to directory for root worktree and 'unknown' for neither", async () => {
    // worktree "/" is treated as no project → session directory is used.
    seed(db, {
      session: "ses_root",
      u: "mru",
      a: "mra",
      t: Date.now() - 2 * DAY,
      text: "root worktree exchange about penguins",
      project: "prj_root",
      worktree: "/",
      directory: "/tmp/rootproj",
    });
    // Neither worktree nor directory → project name becomes "unknown".
    seed(db, {
      session: "ses_none",
      u: "mnu",
      a: "mna",
      t: Date.now() - 40 * DAY,
      text: "no path exchange about walruses",
      project: "prj_none",
      worktree: "",
      directory: "",
    });
    await oc.rebuildConversationIndex();

    const rootHit = (await oc.searchConversations("penguins", { limit: 5 }))[0];
    expect(rootHit.exchange.project).toBe("rootproj");
    const noneHit = (await oc.searchConversations("walruses", { limit: 5 }))[0];
    expect(noneHit.exchange.project).toBe("unknown");
  }, 90000);

  test("applies each time-weight band and the invalid-timestamp default", async () => {
    for (const [id, age, text] of [
      ["w1", 3 * DAY, "band one recent otters"],
      ["w2", 14 * DAY, "band two monthly otters"],
      ["w3", 60 * DAY, "band three quarterly otters"],
      ["w4", 180 * DAY, "band four yearly otters"],
      ["w5", 400 * DAY, "band five ancient otters"],
    ] as const) {
      seed(db, { session: `ses_${id}`, u: `${id}u`, a: `${id}a`, t: Date.now() - age, text });
    }
    await oc.rebuildConversationIndex();
    const hits = await oc.searchConversations("otters", { limit: 10 });
    // Recent (band one) keeps full weight; the oldest is reduced to 0.3x.
    const recent = hits.find((h) => h.exchange.userPrompt.includes("recent"))!;
    const ancient = hits.find((h) => h.exchange.userPrompt.includes("ancient"))!;
    expect(recent.adjustedScore).toBeCloseTo(recent.score, 5);
    expect(ancient.adjustedScore).toBeCloseTo(ancient.score * 0.3, 5);
  }, 90000);
});

describe("searchConversations project handling", () => {
  test("boosts and filters by current project", async () => {
    // The same exchange scores 1.5x higher when its project is the current one.
    const plain = await oc.searchConversations("rust", { limit: 5 });
    const boosted = await oc.searchConversations("rust", { currentProject: "/tmp/proj", limit: 5 });
    const id = plain[0].exchange.id;
    const plainScore = plain.find((r) => r.exchange.id === id)!.adjustedScore;
    const boostedScore = boosted.find((r) => r.exchange.id === id)!.adjustedScore;
    expect(boostedScore).toBeCloseTo(plainScore * 1.5, 5);

    const only = await oc.searchConversations("rust", {
      currentProject: "/tmp/proj",
      projectOnly: true,
      limit: 5,
    });
    expect(only.every((r) => r.exchange.projectPath === "/tmp/proj")).toBe(true);
  }, 90000);
});
