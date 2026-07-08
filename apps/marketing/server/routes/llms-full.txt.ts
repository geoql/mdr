export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  return `# MDR — full project context

## What it is

@geoql/mdr is a persistent, self-maintaining memory plugin for OpenCode and Claude Code. Memory lives as plain markdown and JSON on disk; nothing phones home, no new APIs, no new attack surface.

## Installation

Add to ~/.config/opencode/opencode.json:
\`\`\`json
{ "plugin": ["@geoql/mdr@latest"] }
\`\`\`

For Claude Code:
\`\`\`
/plugin marketplace add geoql/mdr
/plugin install refiner@mdr
\`\`\`

## What it gives you

- Searchable journal (date-partitioned JSONL).
- Entity files (people, projects, topics) as indexed markdown.
- State files: identity.md, human.md, today.md, workspace.md, flags.md — byte-capped, always injected.
- Semantic search over journal, entities, and past conversations via a Vectra vector index. Local embeddings by default (all-MiniLM-L6-v2, 384-dim). Remote OpenAI-compatible endpoint optional.
- Background daemon: cron runner with a heartbeat so a stale process self-heals on next session.
- Scheduled reminders: cron or one-shot. Morning prep, distillation, overnight dream-time reflection.

## Architecture

OpenCode / Claude Code loads the plugin (also an MCP server with id "macrodata"). The plugin reads from state/, journal/, entities/, and .index/. The daemon (croner-based) supervises scheduled agent children.

Storage (default ~/.config/macrodata/):
- identity.md
- state/ (human.md, today.md, workspace.md, flags.md)
- entities/ (people/, projects/, topics/)
- journal/ (date-partitioned JSONL)
- .index/ (Vectra embeddings cache)
- reminders/ (scheduled definitions)
- config.json (optional, e.g. remote embedding provider)

## Environment variables

- MACRODATA_ROOT — override memory root (default ~/.config/macrodata).
- MACRODATA_CONFIG_PATH — override config.json path.
- MACRODATA_CHILD_TIMEOUT_MS — hard timeout for scheduled agent children (default 10 minutes).

## Remote embeddings (optional)

Add an embedding block to config.json:
\`\`\`json
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
\`\`\`

## Fork of ascorbic/macrodata

This fork retains the data directory, the macrodata MCP server id, the macrodata_* tool names, and the MACRODATA_* env vars from upstream, so an existing install keeps its memories and index across the migration. The differences are runtime and operational:

- Node runtime (node:sqlite) instead of Bun. OpenCode no longer ships Bun.
- Merged daemon-hardening + incremental-indexing fixes (PR #34).
- @huggingface/transformers replacing sharp — no native-binary postinstall failure.
- Optional remote OpenAI-compatible embeddings (PR #36).
- Full Vitest suite, 100% coverage.
- geoql release automation (npm + JSR).

## Requirements

- macOS or Linux.
- Node.js >= 24.11.0.

## License

MIT — © Matt Kane (original author, https://github.com/ascorbic) and Vinayak Kulkarni (https://vinayakkulkarni.dev).

## Links

- npm: https://www.npmjs.com/package/@geoql/mdr
- JSR: https://jsr.io/@geoql/mdr
- GitHub: https://github.com/geoql/mdr
- Upstream: https://github.com/ascorbic/macrodata
`;
});
