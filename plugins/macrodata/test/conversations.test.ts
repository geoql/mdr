/**
 * Tests for the Claude Code conversation parser/indexer (src/conversations.ts).
 *
 * os.homedir is redirected to a temp dir so a synthetic ~/.claude/projects
 * tree drives the real scan/parse/index/search/expand code paths against the
 * live embedding model. MACRODATA_ROOT points the vector index at the same
 * temp tree so nothing touches real user data.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const fakeHome = mkdtempSync(join(tmpdir(), "macrodata-cc-home-"));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => fakeHome };
});

const conversations = await import("../src/conversations");

const projectsDir = join(fakeHome, ".claude", "projects");
let stateRoot: string;
let prevRoot: string | undefined;

function jsonl(...objs: unknown[]): string {
  return objs.map((o) => JSON.stringify(o)).join("\n") + "\n";
}

function writeProjectFile(encodedProject: string, file: string, contents: string): string {
  const dir = join(projectsDir, encodedProject);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, file);
  writeFileSync(p, contents);
  return p;
}

const userMsg = (text: string, extra: Record<string, unknown> = {}) => ({
  type: "user",
  uuid: extra.uuid ?? "u-" + text.slice(0, 6),
  sessionId: extra.sessionId ?? "sess-1",
  cwd: extra.cwd ?? "/Users/x/proj",
  gitBranch: extra.gitBranch,
  timestamp: extra.timestamp ?? new Date().toISOString(),
  message: { role: "user", content: text },
  ...extra,
});

const assistantMsg = (text: string) => ({
  type: "assistant",
  uuid: "a-" + text.slice(0, 6),
  message: { role: "assistant", content: [{ type: "text", text }] },
});

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), "macrodata-cc-state-"));
  mkdirSync(join(stateRoot, ".index"), { recursive: true });
  prevRoot = process.env.MACRODATA_ROOT;
  process.env.MACRODATA_ROOT = stateRoot;
  rmSync(projectsDir, { recursive: true, force: true });
  mkdirSync(projectsDir, { recursive: true });
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
  if (prevRoot === undefined) delete process.env.MACRODATA_ROOT;
  else process.env.MACRODATA_ROOT = prevRoot;
});

describe("rebuildConversationIndex", () => {
  test("returns 0 exchanges when there are no project dirs", async () => {
    rmSync(projectsDir, { recursive: true, force: true });
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
  });

  test("parses user/assistant pairs and indexes them", async () => {
    writeProjectFile(
      "-Users-x-Repos-alpha",
      "session-1.jsonl",
      jsonl(
        userMsg("how do I deploy a cloudflare worker", { gitBranch: "main" }),
        assistantMsg("run wrangler deploy from the project root"),
      ),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(1);

    const hits = await conversations.searchConversations("cloudflare worker deploy", { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].exchange.project).toBe("alpha");
    expect(hits[0].exchange.branch).toBe("main");
  }, 60000);

  test("skips tool-results, noise, agent files, hidden and non-dir entries", async () => {
    // Hidden project dir (skipped).
    mkdirSync(join(projectsDir, ".hidden"), { recursive: true });
    // A plain file where a project dir is expected (skipped: not a directory).
    writeFileSync(join(projectsDir, "loose-file"), "x");
    // agent- file is skipped; the real session file has a mix of skippable msgs.
    writeProjectFile(
      "-proj",
      "agent-thing.jsonl",
      jsonl(userMsg("ignored"), assistantMsg("ignored")),
    );
    writeProjectFile(
      "-proj",
      "main.jsonl",
      jsonl(
        {
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", content: "r" }] },
        },
        userMsg("This session is being continued from a previous conversation about stuff"),
        userMsg("   "),
        userMsg("<system-reminder>hook noise</system-reminder>"),
        userMsg("a genuine question about rust ownership", { uuid: "real", gitBranch: "" }),
        assistantMsg("rust ownership means each value has a single owner"),
      ),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(1);
  }, 60000);

  test("skips malformed lines but indexes the valid exchange", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeProjectFile(
      "-proj",
      "mixed.jsonl",
      "{ not json\n" +
        jsonl(userMsg("valid prompt about testing"), assistantMsg("here is a testing answer")),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  }, 60000);

  test("logs and skips a file that cannot be read", async () => {
    // A directory named like a .jsonl makes readFileSync throw EISDIR.
    mkdirSync(join(projectsDir, "-proj", "broken.jsonl"), { recursive: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test("extracts the real user message from an agent-context block", async () => {
    writeProjectFile(
      "-proj",
      "agentctx.jsonl",
      jsonl(
        userMsg("# Agent Context\nsome preamble\nUser message: what is vectra"),
        assistantMsg("vectra is a local vector index"),
      ),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(1);
    const hits = await conversations.searchConversations("what is vectra", { limit: 5 });
    expect(hits[0].exchange.userPrompt).toBe("what is vectra");
  }, 60000);

  test("drops an agent-context block that has no user message", async () => {
    writeProjectFile(
      "-proj",
      "emptyctx.jsonl",
      jsonl(
        userMsg("# Agent Context\nonly preamble, no user line"),
        assistantMsg("this pair is dropped"),
      ),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
  });
});

describe("updateConversationIndex", () => {
  test("indexes new files on a first incremental run", async () => {
    writeProjectFile(
      "-proj",
      "s.jsonl",
      jsonl(userMsg("first prompt here"), assistantMsg("first answer")),
    );
    const result = await conversations.updateConversationIndex();
    expect(result.exchangeCount).toBe(1);
    expect(result.filesUpdated).toBe(1);
  }, 60000);

  test("skips unchanged files and indexes new/changed ones", async () => {
    const p1 = writeProjectFile(
      "-proj",
      "a.jsonl",
      jsonl(userMsg("prompt a about caching"), assistantMsg("answer a")),
    );
    await conversations.rebuildConversationIndex();

    // Keep a.jsonl unchanged; add b.jsonl.
    const past = new Date(Date.now() - 60_000);
    utimesSync(p1, past, past);
    // Re-point state mtime by rebuilding state via a fresh update first.
    await conversations.updateConversationIndex();

    writeProjectFile(
      "-proj",
      "b.jsonl",
      jsonl(userMsg("prompt b about queues"), assistantMsg("answer b")),
    );
    const result = await conversations.updateConversationIndex();
    expect(result.filesUpdated).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  }, 90000);

  test("forgets files that disappeared since the last state", async () => {
    const p = writeProjectFile(
      "-proj",
      "gone.jsonl",
      jsonl(userMsg("prompt to vanish"), assistantMsg("ok")),
    );
    await conversations.rebuildConversationIndex();
    await conversations.updateConversationIndex();

    rmSync(p);
    const result = await conversations.updateConversationIndex();
    expect(result.filesUpdated).toBe(0);
  }, 90000);

  test("embeds a branch-qualified exchange during an incremental update", async () => {
    writeProjectFile("-proj", "seed.jsonl", jsonl(userMsg("seed prompt"), assistantMsg("seed ok")));
    await conversations.rebuildConversationIndex();
    await conversations.updateConversationIndex();
    writeProjectFile(
      "-proj",
      "branched.jsonl",
      jsonl(
        userMsg("branch prompt about caching", { gitBranch: "feature/cache" }),
        assistantMsg("cache ok"),
      ),
    );
    const result = await conversations.updateConversationIndex();
    expect(result.filesUpdated).toBeGreaterThanOrEqual(1);
    const hits = await conversations.searchConversations("caching", { limit: 5 });
    expect(hits.some((h) => h.exchange.branch === "feature/cache")).toBe(true);
  }, 90000);

  test("indexes a changed file with no valid exchanges without failing", async () => {
    writeProjectFile("-proj", "empty.jsonl", jsonl(userMsg("   "), assistantMsg("no pair")));
    await conversations.rebuildConversationIndex();
    const result = await conversations.updateConversationIndex();
    expect(result.exchangeCount).toBe(0);
  }, 60000);
});

describe("searchConversations", () => {
  test("returns [] when the index is empty", async () => {
    const hits = await conversations.searchConversations("anything", { limit: 5 });
    expect(hits).toEqual([]);
  });

  test("boosts and can restrict to the current project", async () => {
    writeProjectFile(
      "-Users-x-alpha",
      "a.jsonl",
      jsonl(
        userMsg("alpha prompt about tiles", { cwd: "/Users/x/alpha" }),
        assistantMsg("alpha tiles answer"),
      ),
    );
    writeProjectFile(
      "-Users-x-beta",
      "b.jsonl",
      jsonl(
        userMsg("beta prompt about tiles", { cwd: "/Users/x/beta" }),
        assistantMsg("beta tiles answer"),
      ),
    );
    await conversations.rebuildConversationIndex();

    const boosted = await conversations.searchConversations("tiles", {
      currentProject: "/Users/x/alpha",
      limit: 5,
    });
    expect(boosted[0].adjustedScore).toBeGreaterThan(boosted[0].score);

    const only = await conversations.searchConversations("tiles", {
      currentProject: "/Users/x/alpha",
      projectOnly: true,
      limit: 5,
    });
    expect(only.every((r) => r.exchange.projectPath === "/Users/x/alpha")).toBe(true);
  }, 90000);

  test("applies reduced time weight to old exchanges", async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    writeProjectFile(
      "-proj",
      "old.jsonl",
      jsonl(
        userMsg("ancient prompt about databases", { timestamp: old }),
        assistantMsg("db answer"),
      ),
    );
    await conversations.rebuildConversationIndex();
    const hits = await conversations.searchConversations("databases", { limit: 5 });
    // 0.3 weight for >1yr old means adjusted < raw.
    expect(hits[0].adjustedScore).toBeLessThan(hits[0].score);
  }, 60000);
});

describe("expandConversation", () => {
  test("throws when the session file is missing", async () => {
    await expect(conversations.expandConversation("/no/such.jsonl", "u")).rejects.toThrow(
      /Session file not found/,
    );
  });

  test("returns context around a found message and reads project + branch", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = writeProjectFile(
      "-proj",
      "expand.jsonl",
      "{ malformed\n" +
        jsonl(
          userMsg("first turn", { uuid: "m1", cwd: "/Users/x/widget", gitBranch: "dev" }),
          assistantMsg("first reply"),
          userMsg("second turn target", { uuid: "target", cwd: "/Users/x/widget" }),
          assistantMsg("second reply"),
          {
            type: "user",
            message: { role: "user", content: [{ type: "tool_result", content: "r" }] },
          },
          userMsg("<system-reminder>noise</system-reminder>"),
        ),
    );
    const result = await conversations.expandConversation(p, "target", 4);
    expect(result.project).toBe("widget");
    expect(result.branch).toBe("dev");
    expect(result.messages.some((m) => m.content === "second turn target")).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("skips assistant messages with empty text and array-only user blocks", async () => {
    const p = writeProjectFile(
      "-proj",
      "emptyasst.jsonl",
      jsonl(
        userMsg("a real question", { uuid: "q1", cwd: "/Users/x/proj" }),
        // Assistant whose only block is non-text → extractAssistantText returns "".
        {
          type: "assistant",
          uuid: "empty",
          message: { role: "assistant", content: [{ type: "thinking", thinking: "x" }] },
        },
        // User with an array that has no text block → extractUserText returns "".
        {
          type: "user",
          uuid: "q2",
          message: { role: "user", content: [{ type: "image", source: "data" }] },
        },
        assistantMsg("a valid reply"),
      ),
    );
    const result = await conversations.expandConversation(p, "q1", 10);
    // The empty-text assistant is not pushed; the array-only user is dropped.
    expect(result.messages.some((m) => m.role === "assistant" && m.content === "")).toBe(false);
    expect(result.messages.some((m) => m.content === "a real question")).toBe(true);
  });

  test("does not push an assistant turn whose text is empty", async () => {
    const p = writeProjectFile(
      "-proj",
      "onlyempty.jsonl",
      jsonl(userMsg("the only real user turn", { uuid: "only", cwd: "/Users/x/proj" }), {
        type: "assistant",
        uuid: "e",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "no text here" }] },
      }),
    );
    const result = await conversations.expandConversation(p, "only", 10);
    expect(result.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  test("ignores non user/assistant messages while parsing", async () => {
    const p = writeProjectFile(
      "-proj",
      "snapshot.jsonl",
      jsonl(
        { type: "file-history-snapshot", uuid: "snap" },
        userMsg("real turn after a snapshot", { uuid: "rt", cwd: "/Users/x/proj" }),
        assistantMsg("a reply"),
      ),
    );
    const result = await conversations.expandConversation(p, "rt", 10);
    expect(result.messages.some((m) => m.content === "real turn after a snapshot")).toBe(true);
  });

  test("returns the last N messages when the target is not found", async () => {
    const p = writeProjectFile(
      "-proj",
      "notfound.jsonl",
      jsonl(userMsg("only turn", { uuid: "x1", cwd: "/Users/x/solo" }), assistantMsg("only reply")),
    );
    const result = await conversations.expandConversation(p, "does-not-exist", 10);
    expect(result.project).toBe("solo");
    expect(result.branch).toBeUndefined();
    expect(result.messages.length).toBe(2);
  });
});

describe("parser branch coverage", () => {
  test("handles string assistant content and missing user metadata", async () => {
    // User message with no uuid/sessionId/timestamp exercises the || fallbacks;
    // string assistant content exercises extractAssistantText's string path.
    writeProjectFile(
      "-proj",
      "strings.jsonl",
      jsonl(
        { type: "user", message: { role: "user", content: "prompt without ids or timestamp" } },
        { type: "assistant", message: { role: "assistant", content: "a plain string reply" } },
      ),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(1);
    const hits = await conversations.searchConversations("prompt without ids", { limit: 5 });
    expect(hits[0].exchange.messageUuid).toBe("");
    expect(hits[0].exchange.sessionId).toBe("strings");
  }, 60000);

  test("skips assistant content with no text block", async () => {
    writeProjectFile(
      "-proj",
      "notext.jsonl",
      jsonl(userMsg("prompt with a thinking-only reply"), {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] },
      }),
    );
    const result = await conversations.rebuildConversationIndex();
    // No assistant text still forms a pair (assistantSummary is empty) but the
    // user text is non-empty, so the exchange is kept.
    expect(result.exchangeCount).toBe(1);
  }, 60000);

  test("treats tool_use_id array content as a tool result and text blocks as prompts", async () => {
    writeProjectFile(
      "-proj",
      "arrays.jsonl",
      jsonl(
        { type: "user", message: { role: "user", content: [{ type: "x", tool_use_id: "t1" }] } },
        {
          type: "user",
          uuid: "arr",
          sessionId: "s",
          cwd: "/Users/x/proj",
          timestamp: new Date().toISOString(),
          message: {
            role: "user",
            content: [{ type: "text", text: "real array prompt about lasers" }],
          },
        },
        assistantMsg("lasers are focused light"),
      ),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(1);
  }, 60000);

  test("skips local-command and command-name noise", async () => {
    writeProjectFile(
      "-proj",
      "cmd.jsonl",
      jsonl(
        userMsg("<local-command-stdout>output</local-command-stdout>"),
        assistantMsg("reply a"),
        userMsg("<command-name>foo</command-name>"),
        assistantMsg("reply b"),
      ),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
  });
});

describe("time weight bands", () => {
  test.each([
    ["14d", 14, "recent-month"],
    ["60d", 60, "recent-quarter"],
    ["180d", 180, "recent-year"],
  ])(
    "applies a reduced weight at %s old",
    async (_label, days) => {
      const ts = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      writeProjectFile(
        "-proj",
        `age.jsonl`,
        jsonl(
          userMsg("aged prompt about networking", { timestamp: ts }),
          assistantMsg("net answer"),
        ),
      );
      await conversations.rebuildConversationIndex();
      const hits = await conversations.searchConversations("networking", { limit: 5 });
      expect(hits[0].adjustedScore).toBeLessThan(hits[0].score);
    },
    60000,
  );
});

describe("directory creation + update no-exchange branch", () => {
  test("creates the index directory when it is absent", async () => {
    rmSync(join(stateRoot, ".index"), { recursive: true, force: true });
    writeProjectFile(
      "-proj",
      "s.jsonl",
      jsonl(userMsg("prompt needing a fresh index dir"), assistantMsg("ok")),
    );
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(1);
  }, 60000);

  test("saves state via mkdir when the index dir is absent on an empty rebuild", async () => {
    rmSync(join(stateRoot, ".index"), { recursive: true, force: true });
    rmSync(projectsDir, { recursive: true, force: true });
    const result = await conversations.rebuildConversationIndex();
    expect(result.exchangeCount).toBe(0);
  });

  test("a changed file that yields no exchanges updates state without indexing", async () => {
    const p = writeProjectFile(
      "-proj",
      "c.jsonl",
      jsonl(userMsg("original prompt"), assistantMsg("ok")),
    );
    await conversations.rebuildConversationIndex();
    await conversations.updateConversationIndex();
    // Rewrite the file with only noise so the changed file has zero exchanges.
    const future = new Date(Date.now() + 60_000);
    writeFileSync(p, jsonl(userMsg("   "), userMsg("<system-reminder>x</system-reminder>")));
    utimesSync(p, future, future);
    const result = await conversations.updateConversationIndex();
    expect(result.filesUpdated).toBeGreaterThanOrEqual(1);
  }, 90000);
});

describe("index reuse", () => {
  test("reuses an existing on-disk conversation index after a cache switch", async () => {
    writeProjectFile("-proj", "s.jsonl", jsonl(userMsg("first index prompt"), assistantMsg("ok")));
    await conversations.rebuildConversationIndex();

    // Switch MACRODATA_ROOT away (drops the cached index instance) then back, so
    // getConversationIndex reopens the already-created on-disk index.
    const other = mkdtempSync(join(tmpdir(), "macrodata-cc-other-"));
    mkdirSync(join(other, ".index"), { recursive: true });
    process.env.MACRODATA_ROOT = other;
    await conversations.getConversationIndexStats();
    process.env.MACRODATA_ROOT = stateRoot;

    const stats = await conversations.getConversationIndexStats();
    expect(stats.exchangeCount).toBeGreaterThan(0);
    rmSync(other, { recursive: true, force: true });
  }, 60000);
});

describe("index state + stats", () => {
  test("getConversationIndexStats reflects indexed exchanges", async () => {
    writeProjectFile(
      "-proj",
      "s.jsonl",
      jsonl(userMsg("stats prompt"), assistantMsg("stats answer")),
    );
    await conversations.rebuildConversationIndex();
    const stats = await conversations.getConversationIndexStats();
    expect(stats.exchangeCount).toBe(1);
  }, 60000);

  test("recovers from a corrupted index-state file", async () => {
    writeProjectFile(
      "-proj",
      "s.jsonl",
      jsonl(userMsg("prompt after corruption"), assistantMsg("ok")),
    );
    await conversations.rebuildConversationIndex();
    // Corrupt the state AFTER the rebuild wrote it, so update's load hits the catch.
    writeFileSync(join(stateRoot, ".index", "conversations-state.json"), "{ corrupt");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await conversations.updateConversationIndex();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Index state corrupted"));
    expect(result.exchangeCount).toBeGreaterThanOrEqual(0);
    warnSpy.mockRestore();
  }, 90000);
});
