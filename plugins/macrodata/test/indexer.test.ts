/**
 * Integration tests for indexer module
 *
 * Tests semantic search indexing with isolated temp directories
 *
 * NOTE: These tests require the @huggingface/transformers embeddings to work,
 * which no longer require a sharp postinstall build step.
 * these tests will be skipped.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestContext,
  setupMinimalState,
  addJournalEntry,
  addEntityFile,
  type TestContext,
} from "./helpers";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "fs";

// Check if embeddings are available by trying to load the pipeline
let embeddingsAvailable = false;
try {
  // Quick check - just see if transformers loads
  await import("@huggingface/transformers");
  embeddingsAvailable = true;
} catch {
  console.warn("[Test] Embeddings not available - skipping indexer tests");
}

// Only import indexer if embeddings work
const indexer = embeddingsAvailable ? await import("../src/indexer") : null;

describe.skipIf(!embeddingsAvailable)("indexer", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    setupMinimalState(ctx);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("indexJournalEntry", () => {
    test(
      "indexes a single journal entry",
      { timeout: 30000 },
      async () => {
        const entry = {
          timestamp: new Date().toISOString(),
          topic: "test-topic",
          content: "This is a test journal entry about integration testing",
        };

        await indexer!.indexJournalEntry(entry);

        const stats = await indexer!.getIndexStats();
        expect(stats.itemCount).toBe(1);
      }
    );

    test("indexed entries are searchable", async () => {
      const entry = {
        timestamp: new Date().toISOString(),
        topic: "cooking",
        content: "Made a delicious pasta carbonara with fresh eggs",
      };

      await indexer!.indexJournalEntry(entry);

      // Search for related content
      const results = await indexer!.searchMemory("italian food pasta", { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain("carbonara");
    });
  });

  describe("rebuildIndex", () => {
    test("indexes journal files from disk", async () => {
      // Add some journal entries to disk
      addJournalEntry(ctx, "topic1", "First journal entry about TypeScript");
      addJournalEntry(ctx, "topic2", "Second journal entry about React");
      addJournalEntry(ctx, "topic3", "Third journal entry about testing");

      const result = await indexer!.rebuildIndex();
      expect(result.itemCount).toBeGreaterThanOrEqual(3);
    });

    test("indexes entity files", async () => {
      // Add entity files
      addEntityFile(
        ctx,
        "people",
        "alice",
        `# Alice

## About

Software engineer at Acme Corp.

## Notes

Works on frontend development.
`
      );

      addEntityFile(
        ctx,
        "projects",
        "widget",
        `# Widget Project

## Description

A widget for managing widgets.

## Status

In progress.
`
      );

      const result = await indexer!.rebuildIndex();
      // Should have entity sections (2+ per file due to section splitting)
      expect(result.itemCount).toBeGreaterThanOrEqual(4);
    });

    test("entity files are searchable after rebuild", async () => {
      addEntityFile(
        ctx,
        "people",
        "bob",
        `# Bob

## About

Backend developer specializing in Rust and Go.

## Notes

Loves systems programming and performance optimization.
`
      );

      await indexer!.rebuildIndex();

      const results = await indexer!.searchMemory("systems programming rust", {
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].type).toBe("person");
    });
  });

  describe("searchMemory", () => {
    test("filters by type", async () => {
      addJournalEntry(ctx, "work", "Fixed a bug in the authentication system");
      addEntityFile(ctx, "projects", "auth", "# Auth\n\n## Description\n\nAuthentication service.");

      await indexer!.rebuildIndex();

      const journalOnly = await indexer!.searchMemory("authentication", {
        type: "journal",
        limit: 5,
      });

      const projectOnly = await indexer!.searchMemory("authentication", {
        type: "project",
        limit: 5,
      });

      // Results should be filtered by type
      for (const result of journalOnly) {
        expect(result.type).toBe("journal");
      }
      for (const result of projectOnly) {
        expect(result.type).toBe("project");
      }
    });

    test("filters by since date", async () => {
      const oldDate = new Date("2024-01-01");
      const newDate = new Date("2025-06-01");

      addJournalEntry(ctx, "old", "Old entry from last year", oldDate);
      addJournalEntry(ctx, "new", "New entry from this year", newDate);

      await indexer!.rebuildIndex();

      const results = await indexer!.searchMemory("entry", {
        since: "2025-01-01",
        limit: 10,
      });

      // Should only get the new entry
      for (const result of results) {
        if (result.timestamp) {
          expect(result.timestamp >= "2025-01-01").toBe(true);
        }
      }
    });

    test("returns empty array for empty index", async () => {
      const results = await indexer!.searchMemory("anything", { limit: 5 });
      expect(results).toEqual([]);
    });
  });

  describe("indexEntityFile", () => {
    test("indexes a single entity file", async () => {
      const filePath = join(ctx.entitiesDir, "people", "charlie.md");
      addEntityFile(
        ctx,
        "people",
        "charlie",
        `# Charlie

## Role

DevOps engineer.

## Skills

Kubernetes, Docker, CI/CD pipelines.
`
      );

      await indexer!.indexEntityFile(filePath);

      const stats = await indexer!.getIndexStats();
      expect(stats.itemCount).toBeGreaterThan(0);

      const results = await indexer!.searchMemory("kubernetes docker", { limit: 5 });
      expect(results.length).toBeGreaterThan(0);
    });

    test("indexes a project file (projects branch)", async () => {
      const filePath = join(ctx.entitiesDir, "projects", "proj.md");
      addEntityFile(ctx, "projects", "proj", "# Proj\n\n## Goal\n\nship it");
      await indexer!.indexEntityFile(filePath);
      const results = await indexer!.searchMemory("ship goal", { limit: 5, type: "project" });
      expect(results.length).toBeGreaterThan(0);
    });

    test("skips a file whose path has no known entity type", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await indexer!.indexEntityFile(join(ctx.root, "loose", "unknown.md"));
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("Unknown entity type");
      errSpy.mockRestore();
    });

    test("logs a read failure for a missing entity file", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await indexer!.indexEntityFile(join(ctx.entitiesDir, "people", "ghost.md"));
      expect(errSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("Failed to index");
      errSpy.mockRestore();
    });

    test("indexes only sections with content, skipping empty ones", async () => {
      const filePath = join(ctx.entitiesDir, "people", "sparse.md");
      // A heading with no body, plus a real section: the empty one is skipped.
      addEntityFile(ctx, "people", "sparse", "## Empty\n\n## Real\n\nactual content here");
      await indexer!.indexEntityFile(filePath);
      const results = await indexer!.searchMemory("actual content", { limit: 5 });
      expect(results.some((r) => r.section === "Real")).toBe(true);
    });
  });

  describe("indexItems / getIndex edge cases", () => {
    test("indexItems is a no-op for an empty list", async () => {
      await indexer!.indexItems([]);
      const stats = await indexer!.getIndexStats();
      expect(stats.itemCount).toBe(0);
    });

    test("getIndex rebuilds against a new root when the path changes", async () => {
      addJournalEntry(ctx, "one", "first root entry");
      await indexer!.rebuildIndex();
      expect((await indexer!.getIndexStats()).itemCount).toBeGreaterThan(0);

      // Switching MACRODATA_ROOT invalidates the cached index instance.
      const ctx2 = createTestContext("macrodata-idx2-");
      setupMinimalState(ctx2);
      expect((await indexer!.getIndexStats()).itemCount).toBe(0);
      ctx2.cleanup();
      process.env.MACRODATA_ROOT = ctx.root;
    });
  });

  describe("rebuildIndex parsing edge cases", () => {
    test("skips malformed journal lines and still indexes valid ones", async () => {
      const file = join(ctx.journalDir, "2025-01-01.jsonl");
      const valid = JSON.stringify({ timestamp: "2025-01-01T00:00:00Z", topic: "ok", content: "valid entry" });
      writeFileSync(file, `${valid}\n{ not json\n\n`);
      const result = await indexer!.rebuildIndex();
      expect(result.itemCount).toBe(1);
    });

    test("indexes a preamble before the first heading", async () => {
      addEntityFile(ctx, "people", "pre", "Intro paragraph before any heading.\n\n## Later\n\nmore");
      const result = await indexer!.rebuildIndex();
      expect(result.itemCount).toBeGreaterThanOrEqual(2);
      const results = await indexer!.searchMemory("intro paragraph", { limit: 5 });
      expect(results.some((r) => r.section === "preamble")).toBe(true);
    });

    test("returns nothing from a journal directory that does not exist", async () => {
      // Fresh root with no journal dir at all.
      const bare = createTestContext("macrodata-idx-bare-");
      const result = await indexer!.rebuildIndex();
      expect(result.itemCount).toBe(0);
      bare.cleanup();
      process.env.MACRODATA_ROOT = ctx.root;
    });
  });

  describe("preloadModel + index bootstrapping", () => {
    test("preloadModel resolves", async () => {
      await expect(indexer!.preloadModel()).resolves.toBeUndefined();
    }, 60000);

    test("getIndex creates the index dir when it is missing", async () => {
      // A root whose .index directory does not exist yet.
      const raw = mkdtempSync(join(tmpdir(), "macrodata-noidx-"));
      const prev = process.env.MACRODATA_ROOT;
      process.env.MACRODATA_ROOT = raw;
      await indexer!.indexItem({
        id: "solo",
        type: "journal",
        content: "a lonely item with no section or timestamp",
        source: "test",
      });
      expect((await indexer!.getIndexStats()).itemCount).toBe(1);
      rmSync(raw, { recursive: true, force: true });
      process.env.MACRODATA_ROOT = prev;
    }, 30000);

    test("indexItems handles items without section or timestamp", async () => {
      await indexer!.indexItems([
        { id: "a", type: "project", content: "no extras here", source: "s" },
      ]);
      expect((await indexer!.getIndexStats()).itemCount).toBe(1);
    });
  });

  describe("parse functions with absent directories and empty sections", () => {
    function bareRoot(): { root: string; restore: () => void } {
      const root = mkdtempSync(join(tmpdir(), "macrodata-empty-"));
      mkdirSync(join(root, ".index"), { recursive: true });
      const prev = process.env.MACRODATA_ROOT;
      process.env.MACRODATA_ROOT = root;
      return {
        root,
        restore: () => {
          rmSync(root, { recursive: true, force: true });
          process.env.MACRODATA_ROOT = prev;
        },
      };
    }

    test("rebuild is empty when journal and entity dirs are all absent", async () => {
      const b = bareRoot();
      const result = await indexer!.rebuildIndex();
      expect(result.itemCount).toBe(0);
      b.restore();
    });

    test("reuses an existing on-disk index instead of recreating it", async () => {
      const b = bareRoot();
      // First build creates the index on disk.
      mkdirSync(join(b.root, "journal"), { recursive: true });
      writeFileSync(
        join(b.root, "journal", "2025-02-02.jsonl"),
        JSON.stringify({ timestamp: "2025-02-02T00:00:00Z", topic: "t", content: "first" }) + "\n"
      );
      await indexer!.rebuildIndex();

      // Switch away and back so the cached instance is dropped but the index
      // files already exist → getIndex must NOT recreate the index.
      const other = createTestContext("macrodata-idx-flip-");
      await indexer!.getIndexStats();
      other.cleanup();
      process.env.MACRODATA_ROOT = b.root;
      const stats = await indexer!.getIndexStats();
      expect(stats.itemCount).toBeGreaterThan(0);
      b.restore();
    });

    test("indexes an entity that starts with a heading (no preamble) and skips empty sections", async () => {
      const b = bareRoot();
      mkdirSync(join(b.root, "entities", "people"), { recursive: true });
      writeFileSync(
        join(b.root, "entities", "people", "head.md"),
        "## Empty\n\n## Filled\n\nreal words here"
      );
      const result = await indexer!.rebuildIndex();
      expect(result.itemCount).toBe(1);
      b.restore();
    });
  });

  describe("indexItem with section metadata", () => {
    test("stores the section field on the indexed item", async () => {
      await indexer!.indexItem({
        id: "sec",
        type: "project",
        content: "content that mentions kubernetes clusters",
        source: "s",
        section: "Infra",
        timestamp: "2025-03-03T00:00:00Z",
      });
      const results = await indexer!.searchMemory("kubernetes clusters", { limit: 5 });
      expect(results[0].section).toBe("Infra");
    });
  });

  describe("searchMemory since-filter with undated results", () => {
    test("keeps results that have no timestamp when filtering by since", async () => {
      addEntityFile(ctx, "people", "dan", "# Dan\n\n## Bio\n\ntimeless profile of dan");
      await indexer!.rebuildIndex();
      const results = await indexer!.searchMemory("timeless profile", {
        since: "2025-01-01",
        limit: 5,
      });
      // Entity results carry no timestamp, so the since filter must keep them.
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
