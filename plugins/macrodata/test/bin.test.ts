/**
 * Tests for the thin bin entry points.
 *
 * Each entry exposes a testable main()/isRunAsMain() so the CLI glue is covered
 * in-process; the only excluded line is the run-as-process-entry guard body.
 */

import { describe, test, expect, vi } from "vitest";
import * as indexConversations from "../bin/index-conversations";
import * as daemonEntry from "../bin/macrodata-daemon";

describe("index-conversations entry", () => {
  test("main reports the update result and returns 0", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await indexConversations.main(async () => ({
      filesUpdated: 3,
      skipped: 1,
      exchangeCount: 42,
    }));
    expect(code).toBe(0);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "Indexed conversations: 3 updated, 1 skipped, 42 total"
    );
    logSpy.mockRestore();
  });

  test("main returns 1 and logs when the update throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await indexConversations.main(async () => {
      throw new Error("update boom");
    });
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  test("isRunAsMain matches argv[1] against the module url", () => {
    expect(indexConversations.isRunAsMain("/a/b.js", "file:///a/b.js")).toBe(true);
    expect(indexConversations.isRunAsMain("/a/b.js", "file:///c.js")).toBe(false);
    expect(indexConversations.isRunAsMain(undefined, "file:///a/b.js")).toBe(false);
  });
});

describe("macrodata-daemon entry", () => {
  test("isRunAsMain matches argv[1] against the module url", () => {
    expect(daemonEntry.isRunAsMain("/a/d.js", "file:///a/d.js")).toBe(true);
    expect(daemonEntry.isRunAsMain("/a/d.js", "file:///e.js")).toBe(false);
    expect(daemonEntry.isRunAsMain(undefined, "file:///a/d.js")).toBe(false);
  });
});
