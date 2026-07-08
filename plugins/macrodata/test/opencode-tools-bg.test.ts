/**
 * Covers rebuild_memory_index's fire-and-forget conversation-rebuild callbacks
 * (both the success .then and the failure .catch) by mocking the conversation
 * and memory-index modules.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const rebuildConv = vi.fn();
const loggerLog = vi.fn();
const loggerError = vi.fn();

vi.mock("../opencode/conversations.js", () => ({
  searchConversations: vi.fn(),
  rebuildConversationIndex: () => rebuildConv(),
  getConversationIndexStats: async () => ({ exchangeCount: 0 }),
}));

vi.mock("../opencode/search.js", () => ({
  searchMemory: vi.fn(),
  rebuildMemoryIndex: async () => ({ itemCount: 0 }),
  getMemoryIndexStats: async () => ({ itemCount: 0 }),
}));

vi.mock("../opencode/logger.js", () => ({
  logger: { log: (m: string) => loggerLog(m), error: (m: string) => loggerError(m), warn: vi.fn() },
}));

const { memoryTools } = await import("../opencode/tools");

type Exec = (args: Record<string, unknown>) => Promise<string>;
const rebuild = () => (memoryTools.macrodata_rebuild_memory_index.execute as unknown as Exec)({});

let root: string;
let prevRoot: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "macrodata-octoolsbg-"));
  mkdirSync(join(root, ".index"), { recursive: true });
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = root;
  loggerLog.mockClear();
  loggerError.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe("rebuild_memory_index background callbacks", () => {
  test("logs success when the conversation rebuild resolves", async () => {
    rebuildConv.mockResolvedValue({ exchangeCount: 7 });
    await rebuild();
    await new Promise((r) => setTimeout(r, 20));
    expect(loggerLog.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "Conversation index rebuilt: 7 exchanges"
    );
  });

  test("logs failure when the conversation rebuild rejects", async () => {
    rebuildConv.mockRejectedValue(new Error("bg rebuild boom"));
    await rebuild();
    await new Promise((r) => setTimeout(r, 20));
    expect(loggerError.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "Conversation index rebuild failed"
    );
  });
});
