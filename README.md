# @geoql/mdr

> Persistent, self-maintaining memory and autonomous scheduling for coding agents (OpenCode, Claude Code).

[![npm](https://img.shields.io/npm/v/@geoql/mdr)](https://www.npmjs.com/package/@geoql/mdr)
[![JSR](https://jsr.io/badges/@geoql/mdr)](https://jsr.io/@geoql/mdr)
[![Pipeline](https://github.com/geoql/mdr/actions/workflows/pipeline.yml/badge.svg)](https://github.com/geoql/mdr/actions/workflows/pipeline.yml)
[![codecov](https://codecov.io/gh/geoql/mdr/graph/badge.svg?token=GHLOD2ZG0N)](https://codecov.io/gh/geoql/mdr)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Macrodata gives an AI coding agent layered, local-first memory: a searchable journal, entity files for people and projects, always-injected state files, semantic search across every past session, a background daemon for scheduled reminders, and overnight self-maintenance. All memory is plain markdown and JSON on disk — nothing phones home, and the whole system runs inside the agent's existing permission model with no new APIs or attack surface.

## Hard fork of ascorbic/macrodata

`@geoql/mdr` is a **hard fork of [ascorbic/macrodata](https://github.com/ascorbic/macrodata) by [Matt Kane](https://github.com/ascorbic)** (published upstream as [`@macrodata/opencode`](https://www.npmjs.com/package/@macrodata/opencode)). The layered-memory architecture, the tools, the skills, and the design are Matt's work — this fork stands entirely on that foundation.

### Why this fork

- **Node/pnpm runtime alignment.** OpenCode no longer ships Bun. Upstream targets the Bun runtime (`bun:sqlite`, `bun:test`, bundled-Bun daemon); this fork replaces those with Node equivalents (`node:sqlite`) so the plugin runs on the same Node runtime as its host, in a pnpm workspace.
- **Merged daemon-hardening + incremental-indexing fixes** ([upstream PR #34](https://github.com/ascorbic/macrodata/pull/34), fixes #25). Hung scheduled children can no longer wedge the daemon forever; a heartbeat lets a stale daemon self-heal on the next session.
- **`@huggingface/transformers` replacing `sharp` postinstall pain** ([upstream PR #35](https://github.com/ascorbic/macrodata/pull/35)). Kills the native-binary postinstall failure under blocked-lifecycle-script package managers. Same model, same 384-dim embeddings; existing indexes stay valid.
- **Optional remote OpenAI-compatible embeddings** ([upstream PR #36](https://github.com/ascorbic/macrodata/pull/36)). Offload embedding generation to an API instead of running the local model.
- **Full Vitest suite at 100% coverage.** Migrated off `bun:test`, with a hard statements/branches/functions/lines gate.
- **geoql release automation.** release-please → npm (OIDC provenance) + JSR, coverage gate, husky/commitlint/lint-staged.

The **data directory (`~/.config/macrodata/`), the MCP server id (`macrodata`), the `macrodata_*` tool names, and the `MACRODATA_*` environment variables are unchanged** from upstream — an existing install keeps its memories and index across the migration.

## Requirements

- macOS or Linux (WSL on Windows is untested).
- [Node.js](https://nodejs.org/) `>=24.11.0`.

## Installation

### OpenCode

Add the plugin to **`~/.config/opencode/opencode.json`**:

```json
{
  "plugin": ["@geoql/mdr@latest"]
}
```

Launch OpenCode and ask it to set up Macrodata.

### Claude Code

```bash
/plugin marketplace add geoql/mdr
/plugin install refiner@mdr
```

## What it does

Every session starts with context injection — identity, current projects, daily focus, and recent activity — so the agent knows who you are and what you're doing before you type anything.

- **Working memory (state files).** A small, always-present working set: `identity.md` (how the agent behaves), `human.md` (who you are), `today.md` (daily focus), `workspace.md` (project context), and topic files. State is a bounded working set, byte-capped per section on injection, with a `flags.md` channel that carries items to you across sessions.
- **Journal.** Observations, decisions, and learnings get appended to a searchable, date-partitioned JSONL journal.
- **Entities.** People, projects, and researched topics live as markdown files under `entities/`, indexed for semantic search.
- **Semantic search.** A [Vectra](https://github.com/Stevenic/vectra) vector index over the journal, entities, and past conversations. By default embeddings are generated locally and offline with `all-MiniLM-L6-v2` (384-dim) via [`@huggingface/transformers`](https://github.com/huggingface/transformers.js); optionally offloaded to a remote endpoint.
- **Conversation analysis.** Indexes past OpenCode and Claude Code sessions so the agent can retrieve relevant context from prior work.
- **Scheduling & autonomy.** A background daemon (a cron runner built on [croner](https://github.com/hexagon/croner)) fires reminders, morning prep, distillation, and overnight "dream time" reflection through the same agent instance with the same permissions you already granted.

## Architecture

```
packages/macrodata/
├── .claude-plugin/plugin.json   # Claude Code plugin manifest (hooks + MCP server)
├── opencode/                    # OpenCode plugin variant
│   ├── index.ts                 # Plugin entry: context injection + tools + daemon supervision
│   ├── tools.ts                 # macrodata_* memory tools
│   ├── context.ts               # State-file context builder
│   ├── search.ts                # Semantic search over the memory index
│   └── skills/                  # Distill, dreamtime, memory-maintenance, onboarding
├── src/                         # MCP server + shared core
│   ├── index.ts                 # MCP server (server id: "macrodata")
│   ├── daemon.ts                # Scheduler / reminder logic
│   ├── indexer.ts               # Vectra index management
│   ├── embeddings.ts            # Local + optional remote embedding generation
│   └── config.ts                # Root + config-path resolution
└── bin/
    ├── macrodata-daemon.ts      # Background daemon entry point
    └── index-conversations.ts   # One-shot conversation indexer
```

**Storage** (default `~/.config/macrodata/`):

```
identity.md          # Agent persona
state/               # human.md, today.md, workspace.md, flags.md
entities/            # people/, projects/, topics/ as markdown
journal/             # date-partitioned JSONL
.index/              # Vectra embeddings cache
reminders/           # scheduled reminder definitions
config.json          # optional (remote embedding provider, etc.)
```

## Configuration

### Environment variables

| Variable                     | Purpose                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `MACRODATA_ROOT`             | Override the memory root directory (default `~/.config/macrodata`).                                    |
| `MACRODATA_CONFIG_PATH`      | Override the path to `config.json` (default `~/.config/macrodata/config.json`).                        |
| `MACRODATA_CHILD_TIMEOUT_MS` | Hard timeout for scheduled agent children before the daemon kills the process group (default 10 min).  |

### Remote embedding provider (optional)

By default embeddings run locally and offline. To offload them to an OpenAI-compatible endpoint, add an `embedding` block to `~/.config/macrodata/config.json`:

```json
{
  "embedding": {
    "provider": "openai-compatible",
    "endpoint": "https://api.example.com/v1",
    "api_key": "sk-...",
    "model": "baai/bge-m3",
    "input_type": "passage",
    "query_input_type": "query",
    "batch_size": 64,
    "extra_body": {}
  }
}
```

Use `api_key_env` instead of `api_key` to read the key from an environment variable. When an `embedding` block is present, the local model is never loaded. Switching to a provider with a different embedding dimension requires rebuilding existing indexes.

## Security

Macrodata runs inside the agent's existing permission model. It uses only the tools you've already installed and approved — no external APIs (unless you opt into a remote embedding endpoint), no third-party skill downloads, no new attack surface. Scheduled tasks run through the same agent instance with the same permissions. The daemon is a simple cron runner that spawns the agent when reminders fire. All state is local markdown and JSON. Nothing phones home.

## Development

```sh
pnpm install
pnpm run lint        # oxlint
pnpm run typecheck   # oxlint --type-aware --type-check
pnpm run build       # vite-plus (vp pack)
pnpm run coverage    # vitest run --coverage (100% gate)
```

Requires Node `>=24.11.0` and pnpm `11.9.0`.

## Inspiration

The layered-memory architecture is inspired by [Letta](https://www.letta.com/), and particularly the [Void](https://cameron.stream/blog/void/) bot by Cameron Pfiffer. The ambient-compute and dream-time concepts are inspired by [Strix](https://timkellogg.me/blog/2025/12/15/strix) by Tim Kellogg. These ideas were first explored by Matt Kane in his Acme agent and released as [ascorbic/macrodata](https://github.com/ascorbic/macrodata).

## License

[MIT](./LICENSE) © [Matt Kane](https://github.com/ascorbic) (original author) and [Vinayak Kulkarni](https://vinayakkulkarni.dev) (fork).
