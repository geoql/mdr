/**
 * Tests for the file-based logger. os.homedir is redirected to a temp dir so
 * the module's load-time mkdir and log writes never touch the real config.
 */

import { describe, test, expect, vi } from "vitest";
import { existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { join } from "path";

const fakeHome = mkdtempSync(join(tmpdir(), "macrodata-logger-home-"));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => fakeHome };
});

const { logger } = await import("../opencode/logger");

const logFile = join(fakeHome, ".config", "macrodata", ".macrodata.log");

describe("logger", () => {
  test("creates the config dir at load and writes leveled lines", () => {
    expect(existsSync(join(fakeHome, ".config", "macrodata"))).toBe(true);

    logger.log("info message");
    logger.error("error message");
    logger.warn("warn message");

    const contents = readFileSync(logFile, "utf-8");
    expect(contents).toMatch(/\[INFO\] info message/);
    expect(contents).toMatch(/\[ERROR\] error message/);
    expect(contents).toMatch(/\[WARN\] warn message/);
  });
});
