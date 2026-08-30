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

## [1.0.5](https://github.com/geoql/mdr/compare/v1.0.4...v1.0.5) (2026-08-30)


### Bug Fixes

* **deps:** bump @opencode-ai/plugin from 1.18.10 to 1.18.11 ([#81](https://github.com/geoql/mdr/issues/81)) ([176997c](https://github.com/geoql/mdr/commit/176997cc83051b235a089cd29dff6c0836804b12))
* **deps:** bump @opencode-ai/plugin from 1.18.11 to 1.18.14 ([#92](https://github.com/geoql/mdr/issues/92)) ([ac30dd2](https://github.com/geoql/mdr/commit/ac30dd2f358db08b27283c94da7b2c01ecfe924f))
* **deps:** bump @opencode-ai/plugin from 1.18.14 to 1.18.15 ([#96](https://github.com/geoql/mdr/issues/96)) ([b356aa3](https://github.com/geoql/mdr/commit/b356aa35f41b002d2bb9d638422ff41ddf2aa86b))
* **deps:** bump @opencode-ai/plugin from 1.18.15 to 1.18.16 ([#102](https://github.com/geoql/mdr/issues/102)) ([7c3180d](https://github.com/geoql/mdr/commit/7c3180de645e303d9802d2497ba0531ff6a1bf93))
* **deps:** bump @opencode-ai/plugin from 1.18.16 to 1.18.18 ([#111](https://github.com/geoql/mdr/issues/111)) ([bb20557](https://github.com/geoql/mdr/commit/bb20557f505826ff69542b35f80c3c4cfcdec7a8))
* **deps:** bump @opencode-ai/plugin from 1.18.18 to 1.18.19 ([#119](https://github.com/geoql/mdr/issues/119)) ([b6c73e1](https://github.com/geoql/mdr/commit/b6c73e152e633d9136abdf45cd7559086adb20bb))
* **deps:** bump @opencode-ai/plugin from 1.18.19 to 1.18.21 ([#127](https://github.com/geoql/mdr/issues/127)) ([c1bb3cd](https://github.com/geoql/mdr/commit/c1bb3cd9cf9631572ccd0e2c99577d4c4d2feab5))
* **deps:** bump @opencode-ai/plugin from 1.18.9 to 1.18.10 ([#71](https://github.com/geoql/mdr/issues/71)) ([6ed4160](https://github.com/geoql/mdr/commit/6ed4160c69562e57b67fc1e706a79e0d61cb7f22))
* **deps:** bump @opencode-ai/sdk from 1.18.10 to 1.18.11 ([#80](https://github.com/geoql/mdr/issues/80)) ([146def8](https://github.com/geoql/mdr/commit/146def8e9f2ba694d2260abf685a5d21e5b83ef4))
* **deps:** bump @opencode-ai/sdk from 1.18.11 to 1.18.14 ([#90](https://github.com/geoql/mdr/issues/90)) ([4e77b74](https://github.com/geoql/mdr/commit/4e77b74985779c6bd9abd7ee0aa618b3ca80ec7d))
* **deps:** bump @opencode-ai/sdk from 1.18.14 to 1.18.15 ([#98](https://github.com/geoql/mdr/issues/98)) ([e4ddc03](https://github.com/geoql/mdr/commit/e4ddc03eeee71fe8d1278160fa1d88c37282e893))
* **deps:** bump @opencode-ai/sdk from 1.18.15 to 1.18.16 ([#103](https://github.com/geoql/mdr/issues/103)) ([957ea05](https://github.com/geoql/mdr/commit/957ea0579c87e133db2bbf54f6ec6d9714540031))
* **deps:** bump @opencode-ai/sdk from 1.18.16 to 1.18.18 ([#112](https://github.com/geoql/mdr/issues/112)) ([17fcdce](https://github.com/geoql/mdr/commit/17fcdce9babc0b10e681cbb2e37250f8f521c14e))
* **deps:** bump @opencode-ai/sdk from 1.18.18 to 1.18.19 ([#122](https://github.com/geoql/mdr/issues/122)) ([cf46b3b](https://github.com/geoql/mdr/commit/cf46b3b750487c7c2f038c0073c7ca9ce4aa4327))
* **deps:** bump @opencode-ai/sdk from 1.18.19 to 1.18.22 ([#140](https://github.com/geoql/mdr/issues/140)) ([2236414](https://github.com/geoql/mdr/commit/2236414959add8006dddf67147882d5f933d7f55))
* **deps:** bump @opencode-ai/sdk from 1.18.9 to 1.18.10 ([#74](https://github.com/geoql/mdr/issues/74)) ([7528631](https://github.com/geoql/mdr/commit/75286314249d8c89095fef4667311ba60b95777b))
* **deps:** bump @types/node from 26.1.2 to 26.2.0 ([#95](https://github.com/geoql/mdr/issues/95)) ([e32d916](https://github.com/geoql/mdr/commit/e32d9160eff3c537ee1d1d932055e0b1c517ee23))
* **deps:** bump @types/node from 26.2.0 to 26.3.0 ([#136](https://github.com/geoql/mdr/issues/136)) ([25f1002](https://github.com/geoql/mdr/commit/25f1002d41f2767fdff4cd210d555693e409b9a2))
* **deps:** bump oxlint from 1.76.0 to 1.77.0 ([#85](https://github.com/geoql/mdr/issues/85)) ([4bcd4e7](https://github.com/geoql/mdr/commit/4bcd4e774b23ea6f2ba69adcb04612b860483d28))
* **deps:** bump oxlint from 1.77.0 to 1.78.0 ([#105](https://github.com/geoql/mdr/issues/105)) ([e7f1fa9](https://github.com/geoql/mdr/commit/e7f1fa901ee24895f1998c8f0bd5605745b05bc8))
* **deps:** bump oxlint from 1.78.0 to 1.79.0 ([#125](https://github.com/geoql/mdr/issues/125)) ([dd9df78](https://github.com/geoql/mdr/commit/dd9df78f73f4d9fd8ce87071fd24d0fba1a226d2))
* **deps:** bump oxlint from 1.79.0 to 1.80.0 ([#133](https://github.com/geoql/mdr/issues/133)) ([28db42e](https://github.com/geoql/mdr/commit/28db42eed327ee02d191922392e90bce560890f7))
* inject onnxruntime-web under Bun to stop NAPI teardown crash ([1a87ba0](https://github.com/geoql/mdr/commit/1a87ba0e00c419d3df3c318e2e08f6dc668e0532))
* inject onnxruntime-web under Bun to stop NAPI teardown crash ([ec971f5](https://github.com/geoql/mdr/commit/ec971f531aa6b2d52fddec2834034e5f89fead24))

## [1.0.4](https://github.com/geoql/mdr/compare/v1.0.3...v1.0.4) (2026-07-31)


### Bug Fixes

* **deps:** bump @modelcontextprotocol/sdk from 1.29.0 to 1.30.0 ([#53](https://github.com/geoql/mdr/issues/53)) ([f123458](https://github.com/geoql/mdr/commit/f1234583bdd25a8de257e095979c0028951cd102))
* **deps:** bump @opencode-ai/plugin from 1.18.3 to 1.18.4 ([#38](https://github.com/geoql/mdr/issues/38)) ([0c19f0e](https://github.com/geoql/mdr/commit/0c19f0e263cb74d4da7e4e6400ba0393f6c442a2))
* **deps:** bump @opencode-ai/plugin from 1.18.4 to 1.18.9 ([#64](https://github.com/geoql/mdr/issues/64)) ([d404448](https://github.com/geoql/mdr/commit/d404448aed8c881242e4003c389d1649210191cc))
* **deps:** bump @opencode-ai/sdk from 1.18.3 to 1.18.4 ([#36](https://github.com/geoql/mdr/issues/36)) ([188cf3e](https://github.com/geoql/mdr/commit/188cf3e2406f79702fac2bcbb3ee4a8448e3b2a3))
* **deps:** bump @opencode-ai/sdk from 1.18.4 to 1.18.5 ([#50](https://github.com/geoql/mdr/issues/50)) ([567edc0](https://github.com/geoql/mdr/commit/567edc08fd9518e02b9c9986e1bddb8f651f8ad0))
* **deps:** bump @opencode-ai/sdk from 1.18.5 to 1.18.7 ([#55](https://github.com/geoql/mdr/issues/55)) ([3c57aa7](https://github.com/geoql/mdr/commit/3c57aa781a92de9b22ab003fc26f6096294ffd77))
* **deps:** bump @opencode-ai/sdk from 1.18.7 to 1.18.9 ([#61](https://github.com/geoql/mdr/issues/61)) ([3366fb0](https://github.com/geoql/mdr/commit/3366fb098982a221b634b54f8ec9196e448a21c7))
* **deps:** bump @types/node from 26.1.1 to 26.1.2 ([#57](https://github.com/geoql/mdr/issues/57)) ([0d8790e](https://github.com/geoql/mdr/commit/0d8790e4e25f332eb7c285ea25ab05dfc9d9fc00))
* **deps:** bump oxlint from 1.74.0 to 1.75.0 ([#41](https://github.com/geoql/mdr/issues/41)) ([5ff7707](https://github.com/geoql/mdr/commit/5ff7707fe5cea2f4e81cdbabfd464b590def8d10))
* **deps:** bump oxlint from 1.75.0 to 1.76.0 ([#60](https://github.com/geoql/mdr/issues/60)) ([fb47d75](https://github.com/geoql/mdr/commit/fb47d7573247ac7600982e9dc455ff000747a121))
* **opencode:** import node:sqlite lazily so the plugin loads outside node ([#69](https://github.com/geoql/mdr/issues/69)) ([100050a](https://github.com/geoql/mdr/commit/100050a42aef82abd54004a14057ba4edd3ffc05)), closes [#68](https://github.com/geoql/mdr/issues/68)

## [1.0.3](https://github.com/geoql/mdr/compare/v1.0.2...v1.0.3) (2026-07-20)


### Bug Fixes

* **daemon:** stop test background-task leak from polluting production log ([#34](https://github.com/geoql/mdr/issues/34)) ([3cd649a](https://github.com/geoql/mdr/commit/3cd649a175dc7c9fd0a7e5c4ce7d9434f8fc88ff)), closes [#31](https://github.com/geoql/mdr/issues/31)

## [1.0.2](https://github.com/geoql/mdr/compare/v1.0.1...v1.0.2) (2026-07-19)


### Bug Fixes

* **deps:** bump @opencode-ai/plugin from 1.17.18 to 1.18.1 ([#15](https://github.com/geoql/mdr/issues/15)) ([8925271](https://github.com/geoql/mdr/commit/8925271ae1f1e1f08e886598a378d478aa2b80f3))
* **deps:** bump @opencode-ai/plugin from 1.18.1 to 1.18.2 ([#18](https://github.com/geoql/mdr/issues/18)) ([91ae46b](https://github.com/geoql/mdr/commit/91ae46bf3b5b72ce808fea43ba1d9915e557453c))
* **deps:** bump @opencode-ai/plugin from 1.18.2 to 1.18.3 ([#22](https://github.com/geoql/mdr/issues/22)) ([6d60f36](https://github.com/geoql/mdr/commit/6d60f3601572f2773c503aedafcc24e2df6cf21c))
* **deps:** bump @opencode-ai/sdk from 1.17.18 to 1.17.20 ([#10](https://github.com/geoql/mdr/issues/10)) ([d93c51a](https://github.com/geoql/mdr/commit/d93c51a16da0cf615f6d597e0dfcb893c002e1ac))
* **deps:** bump @opencode-ai/sdk from 1.17.20 to 1.18.1 ([#14](https://github.com/geoql/mdr/issues/14)) ([a5ca16d](https://github.com/geoql/mdr/commit/a5ca16da9f14cd64fb6bcd09d0fa3e573a6cd3af))
* **opencode:** cap conversation index at 22k items and switch to protobuf codec ([#29](https://github.com/geoql/mdr/issues/29)) ([6fcc25f](https://github.com/geoql/mdr/commit/6fcc25f13a3deea2c6ed2c3cdea9d2451be5ac8d)), closes [#27](https://github.com/geoql/mdr/issues/27)


### Miscellaneous

* **deps:** bump deps to nuxt 4.5.0 ([7388eda](https://github.com/geoql/mdr/commit/7388eda6d21617860ee930acdd2b6e816682bfb3))

## [1.0.1](https://github.com/geoql/mdr/compare/v1.0.0...v1.0.1) (2026-07-12)


### Bug Fixes

* **deps:** bump @opencode-ai/plugin from 1.17.15 to 1.17.18 ([#5](https://github.com/geoql/mdr/issues/5)) ([ab9a434](https://github.com/geoql/mdr/commit/ab9a434c574cca85610e66e64e7d8d0e66f2a2c7))
* **deps:** bump @opencode-ai/sdk from 1.17.15 to 1.17.18 ([#7](https://github.com/geoql/mdr/issues/7)) ([8fb6634](https://github.com/geoql/mdr/commit/8fb6634383cc57bb740792079c97aabe63e0f448))
* **opencode:** make memory context prompt-cache friendly ([edd0fb3](https://github.com/geoql/mdr/commit/edd0fb3ffe9eb058097d7684097cce1e4b7e4756))

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
