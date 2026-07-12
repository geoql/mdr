import type { ArchitectureEdge, ArchitectureNode, Feature } from '~/types';

export const features: readonly Feature[] = [
  {
    key: 'journal',
    num: '01',
    title: 'Searchable journal',
    body: 'Every observation, decision, and learning the agent needs to remember gets appended to a date-partitioned JSONL journal — searchable, never truncated, never pruned.',
    icon: 'journal',
    pills: ['append-only', 'JSONL'],
  },
  {
    key: 'entities',
    num: '02',
    title: 'Entity files',
    body: 'People, projects, and researched topics live as markdown under entities/. New agents discover them on first read; old agents extend them in place. A filing system that grows.',
    icon: 'layers',
    pills: ['markdown', 'people · projects · topics'],
  },
  {
    key: 'state',
    num: '03',
    title: 'Always-on state',
    body: 'identity.md, human.md, today.md, workspace.md. Small, byte-capped, injected every session. The agent knows who you are and what you are on before you type.',
    icon: 'state',
    pills: ['injected first'],
  },
  {
    key: 'search',
    num: '04',
    title: 'Semantic search',
    body: 'A Vectra vector index over the journal, entities, and past conversations. Embeddings run locally and offline with all-MiniLM-L6-v2; opt into an OpenAI-compatible endpoint if you want.',
    icon: 'search',
    pills: ['384-dim', '100% local'],
  },
  {
    key: 'daemon',
    num: '05',
    title: 'Background daemon',
    body: 'A cron runner supervises the agent. Hung children can no longer wedge the daemon (PR #34); a heartbeat lets a stale daemon self-heal on the next session.',
    icon: 'daemon',
    pills: ['heartbeat · restart'],
  },
  {
    key: 'cron',
    num: '06',
    title: 'Scheduled reminders',
    body: 'Reminders, morning prep, distillation, and overnight dream-time reflection — through the same agent instance with the same permissions. Cron or one-shot.',
    icon: 'cron',
    pills: ['cron · one-shot'],
  },
] as const;

export const architectureNodes: readonly ArchitectureNode[] = [
  {
    key: 'agent',
    label: 'OpenCode / Claude Code',
    hint: 'the host agent',
  },
  {
    key: 'plugin',
    label: '@geoql/mdr',
    hint: 'plugin + MCP server',
  },
  {
    key: 'state',
    label: 'state/',
    hint: 'always-injected',
  },
  {
    key: 'journal',
    label: 'journal/',
    hint: 'append-only JSONL',
  },
  {
    key: 'entities',
    label: 'entities/',
    hint: 'people · projects · topics',
  },
  {
    key: 'index',
    label: '.index/',
    hint: 'Vectra · 384-dim',
  },
  {
    key: 'daemon',
    label: 'macrodata-daemon',
    hint: 'cron runner · heartbeat',
  },
  {
    key: 'reminders',
    label: 'reminders/',
    hint: 'scheduled · cron · once',
  },
];

export const architectureEdges: readonly ArchitectureEdge[] = [
  { from: 'agent', to: 'plugin' },
  { from: 'plugin', to: 'state' },
  { from: 'plugin', to: 'journal' },
  { from: 'plugin', to: 'entities' },
  { from: 'journal', to: 'index' },
  { from: 'entities', to: 'index' },
  { from: 'plugin', to: 'daemon' },
  { from: 'daemon', to: 'reminders' },
  { from: 'daemon', to: 'plugin' },
];
