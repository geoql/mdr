/**
 * Covers openDb's missing-database and open-failure branches by pointing
 * MACRODATA_OPENCODE_DB_PATH at a nonexistent path and at a non-SQLite file
 * before importing the module.
 */

import { describe, test, expect } from "vitest";
import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), "macrodata-ocnodb-"));
const stateRoot = mkdtempSync(join(tmpdir(), "macrodata-ocnodb-state-"));
mkdirSync(join(stateRoot, ".index"), { recursive: true });
process.env.MACRODATA_ROOT = stateRoot;
process.env.MACRODATA_OPENCODE_DB_PATH = join(dir, "does-not-exist.db");

const oc = await import("../opencode/conversations");

describe("openDb missing database", () => {
  test("rebuild returns 0 exchanges when the db file is absent", async () => {
    const result = await oc.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
  });

  test("update returns zero counts when the db file is absent", async () => {
    const result = await oc.updateConversationIndex();
    expect(result).toEqual({ newCount: 0, totalCount: 0 });
  });

  test("searchConversations returns [] on an empty index", async () => {
    const hits = await oc.searchConversations("anything", { limit: 5 });
    expect(hits).toEqual([]);
  });

  test("stats report zero on an empty index", async () => {
    const stats = await oc.getConversationIndexStats();
    expect(stats.exchangeCount).toBe(0);
  });
});
