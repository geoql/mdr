/**
 * Covers the beginUpdate/upsert failure branches (cancelUpdate + rethrow) and
 * the update latest-timestamp computation, by mocking vectra's LocalIndex and
 * pointing at a seeded temp SQLite database.
 */

import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const cancelUpdate = vi.fn();
const hoisted = vi.hoisted(() => ({
  existingItems: [] as Array<{ id: string; metadata: Record<string, string> }>,
  queryResults: [] as unknown[],
  upsertThrows: true,
}));
vi.mock("vectra", () => ({
  LocalIndex: class {
    async isIndexCreated() {
      return true;
    }
    async createIndex() {}
    async deleteIndex() {}
    async listItems() {
      return hoisted.existingItems;
    }
    async beginUpdate() {}
    endUpdate() {}
    cancelUpdate() {
      cancelUpdate();
    }
    async upsertItem() {
      if (hoisted.upsertThrows) throw new Error("oc upsert exploded");
    }
    async queryItems() {
      return hoisted.queryResults;
    }
  },
}));

vi.mock("../src/embeddings.js", () => ({
  embedBatch: async (t: string[]) => t.map(() => [0.1, 0.2, 0.3]),
  embedQuery: async () => [0.1, 0.2, 0.3],
  preloadModel: async () => {},
}));

const dbPath = join(mkdtempSync(join(tmpdir(), "macrodata-ocerr-")), "opencode.db");
const stateRoot = mkdtempSync(join(tmpdir(), "macrodata-ocerr-state-"));
mkdirSync(join(stateRoot, ".index"), { recursive: true });
process.env.MACRODATA_OPENCODE_DB_PATH = dbPath;
process.env.MACRODATA_ROOT = stateRoot;

const oc = await import("../opencode/conversations");

let db: DatabaseSync;

beforeAll(() => {
  db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT)`);
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER)`);
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)`);
  db.exec(`CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)`);
  db.exec(`INSERT INTO project (id, worktree) VALUES ('p', '/tmp/w')`);
  db.exec(`INSERT INTO session (id, project_id, parent_id, directory, time_created) VALUES ('s', 'p', NULL, '/tmp/w', 1000)`);
  db.exec(`INSERT INTO message (id, session_id, time_created, data) VALUES ('u', 's', 1000, '{"role":"user"}')`);
  db.exec(`INSERT INTO message (id, session_id, time_created, data) VALUES ('a', 's', 2000, '{"role":"assistant"}')`);
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES ('up', 'u', 's', 1000, ?)`).run(
    JSON.stringify({ type: "text", text: "a prompt that will fail upsert" })
  );
  db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES ('ap', 'a', 's', 2000, ?)`).run(
    JSON.stringify({ type: "text", text: "reply" })
  );
});

afterAll(() => {
  db.close();
  rmSync(stateRoot, { recursive: true, force: true });
});

describe("index lifecycle branches", () => {
  test("creates the index dir on demand and returns 0 for a db with no exchanges", async () => {
    hoisted.upsertThrows = false;
    // Remove the text parts so every exchange has empty user_text and is
    // filtered out by the query's HAVING clause → 0 exchanges.
    db.exec(`DELETE FROM part`);
    // Drop the .index dir so getConversationIndex must recreate it.
    rmSync(join(stateRoot, ".index"), { recursive: true, force: true });
    const result = await oc.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
    // Restore the parts for later tests.
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES ('up', 'u', 's', 1000, ?)`).run(
      JSON.stringify({ type: "text", text: "a prompt that will fail upsert" })
    );
    db.prepare(`INSERT INTO part (id, message_id, session_id, time_created, data) VALUES ('ap', 'a', 's', 2000, ?)`).run(
      JSON.stringify({ type: "text", text: "reply" })
    );
    hoisted.upsertThrows = true;
  });

  test("skips deleteIndex when the index is not yet created", async () => {
    hoisted.upsertThrows = false;
    const { LocalIndex } = await import("vectra");
    const createdSpy = vi.spyOn(LocalIndex.prototype, "isIndexCreated").mockResolvedValue(false);
    const deleteSpy = vi.spyOn(LocalIndex.prototype, "deleteIndex");
    hoisted.existingItems = [];
    await oc.rebuildConversationIndex();
    expect(deleteSpy).not.toHaveBeenCalled();
    createdSpy.mockRestore();
    deleteSpy.mockRestore();
    hoisted.upsertThrows = true;
  });
});

describe("upsert failure handling", () => {
  test("rebuild cancels the update and rethrows on upsert failure", async () => {
    hoisted.existingItems = [];
    await expect(oc.rebuildConversationIndex()).rejects.toThrow(/oc upsert exploded/);
    expect(cancelUpdate).toHaveBeenCalled();
  });

  test("update cancels the update and rethrows on upsert failure", async () => {
    // An existing item with a timestamp drives the latest-ms narrowing branch.
    hoisted.existingItems = [{ id: "oc-existing", metadata: { timestamp: new Date(500).toISOString() } }];
    cancelUpdate.mockClear();
    await expect(oc.updateConversationIndex()).rejects.toThrow(/oc upsert exploded/);
    expect(cancelUpdate).toHaveBeenCalled();
  });

  test("update reports zero new when every exchange is already indexed", async () => {
    hoisted.upsertThrows = false;
    // Pre-seed the existing set with the id the query will produce.
    hoisted.existingItems = [{ id: "oc-s-u", metadata: { timestamp: new Date(1000).toISOString() } }];
    const result = await oc.updateConversationIndex();
    expect(result.newCount).toBe(0);
    hoisted.upsertThrows = true;
  });

  test("update uses no since-filter when existing items lack timestamps", async () => {
    hoisted.upsertThrows = false;
    // No timestamps → latestMs stays 0 → sinceMs is undefined (full query).
    hoisted.existingItems = [{ id: "oc-s-u", metadata: {} }];
    const result = await oc.updateConversationIndex();
    expect(result.newCount).toBe(0);
    hoisted.upsertThrows = true;
  });

  test("update keeps the max timestamp when a later item precedes an earlier one", async () => {
    hoisted.upsertThrows = false;
    // The second item's ms is lower, so the ms > latestMs guard is false.
    hoisted.existingItems = [
      { id: "oc-s-u", metadata: { timestamp: new Date(2000).toISOString() } },
      { id: "oc-other", metadata: { timestamp: new Date(500).toISOString() } },
    ];
    const result = await oc.updateConversationIndex();
    expect(result.newCount).toBe(0);
    hoisted.upsertThrows = true;
  });

  test("searchConversations defaults the weight for an invalid timestamp", async () => {
    hoisted.existingItems = [{ id: "x", metadata: {} }];
    hoisted.queryResults = [
      { item: { id: "oc-x", metadata: { userPrompt: "p", timestamp: "not-a-date", projectPath: "/tmp/w" } }, score: 0.9 },
    ];
    const hits = await oc.searchConversations("anything", { limit: 5 });
    expect(hits[0].adjustedScore).toBeCloseTo(hits[0].score * 0.5, 5);
    hoisted.queryResults = [];
  });
});
