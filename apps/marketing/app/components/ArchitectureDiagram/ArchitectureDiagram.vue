<script setup lang="ts">
  import { architectureNodes } from '~/data/landing';
  import type { ArchitectureNode } from '~/types';

  defineProps<{
    kicker: string;
    title: string;
    sub: string;
  }>();

  function rowOf(key: string): number {
    if (['agent', 'plugin'].includes(key)) return 0;
    if (['state', 'journal', 'entities', 'daemon'].includes(key)) return 1;
    return 2;
  }

  function nodeHint(node: ArchitectureNode): string {
    return node.hint;
  }
</script>

<template>
  <section
    id="architecture"
    class="border-t border-border-soft py-24 lg:py-32 bg-surface"
  >
    <div class="mx-auto max-w-330 px-5 lg:px-8">
      <div class="max-w-[58ch] mb-14">
        <span
          class="font-mono text-[11.5px] tracking-[0.14em] uppercase text-ink-muted"
          >{{ kicker }}</span
        >
        <h2
          class="font-display font-400 text-ink leading-[1.05] tracking-tight mt-3 mb-4 text-[clamp(36px,4.8vw,56px)]"
        >
          {{ title }}
        </h2>
        <p
          class="text-ink-muted text-[clamp(15.5px,1.3vw,18px)] leading-[1.6] max-w-[60ch]"
        >
          {{ sub }}
        </p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8">
        <div
          class="rounded-lg border border-border bg-bg p-6 lg:p-7 relative overflow-hidden"
        >
          <div
            aria-hidden="true"
            class="absolute inset-0 dot-grid opacity-40 pointer-events-none"
          />

          <div class="relative space-y-4">
            <div
              v-for="row in 3"
              :key="row"
              class="grid grid-cols-4 gap-3"
            >
              <template
                v-for="node in architectureNodes.filter(
                  (n) => rowOf(n.key) === row - 1,
                )"
                :key="node.key"
              >
                <div
                  class="rounded-md bg-surface border border-border p-3"
                  :class="{
                    'border-accent!': node.key === 'plugin',
                  }"
                  :style="`
                    ${
                      node.key === 'plugin'
                        ? 'box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 30%, transparent);'
                        : ''
                    }
                  `"
                >
                  <div
                    class="font-data text-[10.5px] text-ink-dim uppercase tracking-[0.14em] mb-1"
                  >
                    {{ nodeHint(node) }}
                  </div>
                  <div
                    class="font-mono text-[13.5px] text-ink leading-[1.3]"
                  >
                    {{ node.label }}
                  </div>
                </div>
              </template>
            </div>

            <div
              class="font-data text-[10.5px] text-ink-dim uppercase tracking-[0.14em] pt-2"
            >
              <span class="mr-3">→ plugin reads from index</span>
              <span class="mr-3">→ daemon reads from reminders</span>
              <span>→ heartbeat self-heals stale daemon</span>
            </div>
          </div>
        </div>

        <div
          class="rounded-lg border border-border bg-bg p-6 lg:p-7 space-y-5"
        >
          <div>
            <h3
              class="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted m-0 mb-2.5"
            >
              Storage layout
            </h3>
            <pre
              class="font-data text-[12.5px] text-ink-muted leading-[1.7] m-0 whitespace-pre-wrap"
            ><span class="text-ink">~/.config/macrodata/</span>
├── <span class="text-ink">identity.md</span>
├── <span class="text-ink">state/</span>
│   ├── <span class="text-ink">human.md</span>
│   ├── <span class="text-ink">today.md</span>
│   ├── <span class="text-ink">workspace.md</span>
│   └── <span class="text-ink">flags.md</span>
├── <span class="text-ink">entities/</span>
│   ├── <span class="text-ink-dim">people/</span>
│   ├── <span class="text-ink-dim">projects/</span>
│   └── <span class="text-ink-dim">topics/</span>
├── <span class="text-ink">journal/</span>      <span class="text-ink-dim"># date-partitioned JSONL</span>
├── <span class="text-ink">.index/</span>        <span class="text-ink-dim"># Vectra · 384-dim</span>
└── <span class="text-ink">reminders/</span></pre>
          </div>

          <div>
            <h3
              class="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted m-0 mb-2.5"
            >
              Override paths
            </h3>
            <ul class="list-none p-0 m-0 space-y-1.5 font-data text-[12.5px]">
              <li class="flex items-baseline gap-2">
                <span class="text-ink-muted shrink-0 w-[18ch]"
                  >MACRODATA_ROOT</span
                >
                <span class="text-ink-dim">memory root dir</span>
              </li>
              <li class="flex items-baseline gap-2">
                <span class="text-ink-muted shrink-0 w-[18ch]"
                  >MACRODATA_CONFIG_PATH</span
                >
                <span class="text-ink-dim">config.json path</span>
              </li>
              <li class="flex items-baseline gap-2">
                <span class="text-ink-muted shrink-0 w-[18ch]"
                  >MACRODATA_CHILD_TIMEOUT_MS</span
                >
                <span class="text-ink-dim">hard cap on scheduled agent runs</span>
              </li>
            </ul>
          </div>

          <p class="text-ink-muted text-[13px] leading-[1.6] m-0">
            All state stays on your disk. Nothing phones home. Switch to a remote
            embedding endpoint any time — the local model is never loaded when
            one is configured.
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
