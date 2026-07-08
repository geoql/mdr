/**
 * Covers the beginUpdate/upsert failure branches (cancelUpdate + rethrow) in
 * both rebuildConversationIndex and updateConversationIndex by mocking vectra's
 * LocalIndex so upsertItem throws.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeHome = mkdtempSync(join(tmpdir(), "macrodata-cc-upsert-home-"));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => fakeHome };
});

const cancelUpdate = vi.fn();

vi.mock("vectra", () => ({
  LocalIndex: class {
    async isIndexCreated() {
      return true;
    }
    async createIndex() {}
    async listItems() {
      return [];
    }
    async beginUpdate() {}
    endUpdate() {}
    cancelUpdate() {
      cancelUpdate();
    }
    async upsertItem() {
      throw new Error("upsert exploded");
    }
    async queryItems() {
      return [];
    }
  },
}));

vi.mock("../src/embeddings.js", () => ({
  embedBatch: async (t: string[]) => t.map(() => [0.1, 0.2, 0.3]),
  embedQuery: async () => [0.1, 0.2, 0.3],
  preloadModel: async () => {},
}));

const conversations = await import("../src/conversations");

const projectsDir = join(fakeHome, ".claude", "projects");
let stateRoot: string;
let prevRoot: string | undefined;

function jsonl(...objs: unknown[]): string {
  return objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
}

function writeProjectFile(project: string, file: string, contents: string) {
  const dir = join(projectsDir, project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), contents);
}

const pair = () =>
  jsonl(
    {
      type: "user",
      uuid: "u1",
      sessionId: "s1",
      cwd: "/Users/x/proj",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "a prompt that will fail to upsert" },
    },
    { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } }
  );

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), "macrodata-cc-upsert-state-"));
  mkdirSync(join(stateRoot, ".index"), { recursive: true });
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = stateRoot;
  rmSync(projectsDir, { recursive: true, force: true });
  mkdirSync(projectsDir, { recursive: true });
  cancelUpdate.mockClear();
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe("upsert failure handling", () => {
  test("rebuild cancels the update and rethrows on upsert failure", async () => {
    writeProjectFile("-proj", "s.jsonl", pair());
    await expect(conversations.rebuildConversationIndex()).rejects.toThrow(/upsert exploded/);
    expect(cancelUpdate).toHaveBeenCalled();
  });

  test("update cancels the update and rethrows on upsert failure", async () => {
    writeProjectFile("-proj", "s.jsonl", pair());
    await expect(conversations.updateConversationIndex()).rejects.toThrow(/upsert exploded/);
    expect(cancelUpdate).toHaveBeenCalled();
  });
});
