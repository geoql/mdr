# @geoql/mdr

> `@geoql/mdr` is a hard fork of [`@macrodata/opencode`](https://www.npmjs.com/package/@macrodata/opencode)
> from [ascorbic/macrodata](https://github.com/ascorbic/macrodata) by
> [Matt Kane](https://github.com/ascorbic). Entries below the fork marker are
> the upstream changelog, preserved verbatim. From here forward this changelog
> is maintained by [release-please](https://github.com/googleapis/release-please).

## Unreleased (fork divergence from ascorbic/macrodata@0.3.0)

Forked from upstream at commit
[`ee80b99`](https://github.com/ascorbic/macrodata/commit/ee80b99413099f94c5f9b0b14c4f6dcc3a14aadd)
(`chore: genericize personal references (#32)`), the last upstream commit at the
`0.3.0` release. This fork layers the following on top:

### Merged upstream contribution PRs

- **Repair incremental indexing SQL + harden the daemon against hung children
  ([#34](https://github.com/ascorbic/macrodata/pull/34), fixes #25).** Two bugs
  that silently disabled the plugin for weeks. Scheduled `opencode run` /
  `claude --print` children are now supervised with a hard timeout (default 10
  minutes, `MACRODATA_CHILD_TIMEOUT_MS`); on timeout the child's process group is
  killed and the daemon keeps running. The daemon installs
  `unhandledRejection` / `uncaughtException` handlers and writes a
  `.daemon.heartbeat` every minute; the plugin restarts a PID-alive-but-stale
  daemon on the next session, so a wedged daemon self-heals instead of staying
  dead for days.
- **Migrate `@xenova/transformers` → `@huggingface/transformers`
  ([#35](https://github.com/ascorbic/macrodata/pull/35), addresses #24).**
  Eliminates the `sharp` postinstall failure that broke the native binary
  install under blocked-lifecycle-script package managers — including when the
  plugin is installed through OpenCode's generated wrapper package. Same model,
  same 384-dim embeddings; existing indexes stay valid. The daemon lazy-loads
  the indexing modules so its PID file appears in ~300ms instead of ~4.6s.
- **Optional remote OpenAI-compatible embedding provider
  ([#36](https://github.com/ascorbic/macrodata/pull/36)).** Configure an
  embeddings endpoint in `~/.config/macrodata/config.json` to offload embedding
  generation to an API instead of running the local Transformers.js model. When
  configured, the local model is never loaded (no download, no inference CPU).
  Without the `embedding` block, behavior is unchanged: local
  `all-MiniLM-L6-v2`, fully offline. Supports `api_key` / `api_key_env`,
  per-request `input_type` / `query_input_type`, `batch_size`, and `extra_body`
  passthrough.

### Runtime and toolchain migration (geoql)

- **Bun → pnpm / Node.** Replaced Bun-specific APIs (`bun:sqlite`,
  `bun:test`, bundled-Bun daemon startup) with Node equivalents (`node:sqlite`),
  moved to a pnpm workspace, and target Node `>=24.11.0`. OpenCode no longer
  ships Bun, so the plugin now runs on the same Node runtime as its host.
- **Vitest suite at 100% coverage.** Migrated the test suite from `bun:test`
  to Vitest with a hard 100% statements/branches/functions/lines gate, extracted
  daemon and MCP-server logic into testable modules, and made the suite hermetic
  against a developer's real `~/.config/macrodata/config.json`.
- **geoql release automation.** release-please → npm (OIDC provenance) + JSR,
  a coverage gate, and husky/commitlint/lint-staged, mirroring the
  [geoql/doctor](https://github.com/geoql/doctor) conventions.

<!-- fork marker — everything below is the upstream ascorbic/macrodata changelog -->

## 1.0.0 (2026-07-08)

### Documentation

- point codecov badge at tokened URL; gitignore .cortexkit ([926f279](https://github.com/geoql/mdr/commit/926f279b27fa38c04de18c2d143308fb845be1bc))

### Code Refactoring

- move plugin to packages/ to match geoql workspace convention ([63e8e01](https://github.com/geoql/mdr/commit/63e8e014bcbe4693cf3bb452a20edd8af06e9680))
- **test:** use ~/~~ path aliases for imports ([7feb237](https://github.com/geoql/mdr/commit/7feb2373ee9ce7810cc590d9eac672e3de6c9bbc))

## 0.3.0

### Minor Changes

- [#30](https://github.com/ascorbic/macrodata/pull/30) [`2807c49`](https://github.com/ascorbic/macrodata/commit/2807c492349f6dbcb715707ab7a68a556aac7481) Thanks [@ascorbic](https://github.com/ascorbic)! - Budget the injected context and add a flags channel.

  State files are now treated as a bounded working set instead of an append-only log. The SessionStart injection is byte-capped per section, so a bloated file can no longer blow the whole context past the harness limit (which was silently truncating it to a preview and dropping most of it). A new `state/flags.md` channel carries items to the user across sessions and is injected first so it always survives. The prompt-submit full re-dump that defeated prompt caching is removed — state changes now arrive as targeted deltas. `USAGE.md` and the memory-maintenance/dreamtime skills are updated to keep state bounded with explicit eviction (detail belongs in the journal and entity files, which are durable and searchable).

### Patch Changes

- [#17](https://github.com/ascorbic/macrodata/pull/17) [`bf421cb`](https://github.com/ascorbic/macrodata/commit/bf421cba85a095391b6e85cc7864f3de622aee28) Thanks [@jasikpark](https://github.com/jasikpark)! - Log malformed lines in conversation parsing instead of silently skipping them. Corrupted index state now warns on reset. Makes it possible to diagnose why a session isn't appearing in search results.

## 0.2.1

### Patch Changes

- [#12](https://github.com/ascorbic/macrodata/pull/12) [`a8906f5`](https://github.com/ascorbic/macrodata/commit/a8906f5c98db2c16fe0d44f29c8d9ed339909d23) Thanks [@ascorbic](https://github.com/ascorbic)! - Update distill skill for SQLite session storage format

## 0.2.0

### Minor Changes

- [#9](https://github.com/ascorbic/macrodata/pull/9) [`9c37516`](https://github.com/ascorbic/macrodata/commit/9c37516367cec8474483373ace3b529ea87410f6) Thanks [@ascorbic](https://github.com/ascorbic)! - Read OpenCode conversations from SQLite instead of file-based storage. Uses `bun:sqlite` with no new dependencies. Fixes project resolution by joining session to project worktree. Requires OpenCode v1.2.0+.

### Patch Changes

- [#10](https://github.com/ascorbic/macrodata/pull/10) [`8c4d770`](https://github.com/ascorbic/macrodata/commit/8c4d7703ee52cb3809d0c4ab132849530f003174) Thanks [@ascorbic](https://github.com/ascorbic)! - Move context injection from chat.message hook to system prompt transform. Fixes session titles all showing as "innie memory system setup" because synthetic message parts were sent to the title generation LLM.

## 0.1.3

### Patch Changes

- [#5](https://github.com/ascorbic/macrodata/pull/5) [`acb2066`](https://github.com/ascorbic/macrodata/commit/acb20667b40435839f81359aba8a0904a394b43a) Thanks [@ascorbic](https://github.com/ascorbic)! - Include USAGE.md in published package

## 0.1.2

### Patch Changes

- [`bdec5e7`](https://github.com/ascorbic/macrodata/commit/bdec5e7ab8f7e1537ff63fdcc64672a836aa63e8) Thanks [@ascorbic](https://github.com/ascorbic)! - Improve context injection and fix schedules display

  - Use XML tags for context sections (better parsing)
  - Fix schedules to read from reminders directory
  - Add shared USAGE.md with explicit guidance
  - Dynamic entity directory scanning
  - Notify pending context on state/entity file changes

## 0.1.1

### Patch Changes

- [`5973e45`](https://github.com/ascorbic/macrodata/commit/5973e45f3e4a3fcf02011e525678f71f63ce2dd0) Thanks [@ascorbic](https://github.com/ascorbic)! - Fix daemon file watcher and conversation indexing

  - Fix reminders watcher not detecting new files (watch directory instead of glob pattern)
  - Index both Claude Code and OpenCode conversations on daemon startup

- [`5dc8366`](https://github.com/ascorbic/macrodata/commit/5dc8366a6a9df8a274b0f8861151895effd30020) Thanks [@ascorbic](https://github.com/ascorbic)! - Add daemon hot-reload support and cleanup

  - Daemon now supports SIGHUP to reload config without restart
  - Daemon logs to file instead of console
  - Hook and OpenCode plugin signal daemon reload on session start
  - Context now lists actual state/entity files instead of just paths
  - Dynamic import of transformers library for faster startup
  - Remove redundant readStateFile and indexFile tools

## 0.1.0

### Minor Changes

- [`c53012e`](https://github.com/ascorbic/macrodata/commit/c53012eaaf031ccd812afc4d472754a8226f2f6c) Thanks [@ascorbic](https://github.com/ascorbic)! - Initial version
