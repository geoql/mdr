<script setup lang="ts">
  defineProps<{
    kicker: string;
    title: string;
    sub: string;
  }>();
</script>

<template>
  <section
    id="install"
    class="border-t border-border-soft py-24 lg:py-32 bg-surface"
  >
    <div class="mx-auto max-w-330 px-5 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-12 items-start">
        <div class="max-w-[58ch]">
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

        <div class="space-y-5">
          <div
            class="rounded-lg border border-border bg-bg p-5"
          >
            <div
              class="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-muted mb-3"
            >
              OpenCode — opencode.json
            </div>
            <div
              class="flex items-center gap-0 bg-surface border border-border rounded-md py-1.5 pl-3.5 pr-1.5 focus-within:border-ink-muted"
            >
              <code
                class="font-mono text-[13.5px] text-ink flex-1 min-w-0 truncate"
                >{ "plugin": ["@geoql/mdr@latest"] }</code
              >
              <CopyButton
                :text='"{ \"plugin\": [\"@geoql/mdr@latest\"] }"'
                label="Copy"
                success-label="Copied"
              />
            </div>
          </div>

          <div
            class="rounded-lg border border-border bg-bg p-5"
          >
            <div
              class="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-muted mb-3"
            >
              Claude Code
            </div>
            <div
              class="font-mono text-[13.5px] text-ink space-y-1"
            >
              <div><span class="text-ink-dim select-none mr-2">$</span>/plugin marketplace add geoql/mdr</div>
              <div><span class="text-ink-dim select-none mr-2">$</span>/plugin install macrodata@macrodata</div>
            </div>
            <a
              href="https://github.com/geoql/mdr"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-ink-muted text-[12.5px] hover:text-ink mt-3"
            >
              <Icon name="lucide:book-open" class="size-3.5" />
              Full installation guide
              <Icon
                name="lucide:arrow-up-right"
                class="size-3.5"
              />
            </a>
          </div>

          <div
            class="flex items-center gap-2 pt-1 text-ink-muted text-[13px]"
          >
            <span>or install via</span>
            <a
              href="https://www.npmjs.com/package/@geoql/mdr"
              target="_blank"
              rel="noopener noreferrer"
              class="underline underline-offset-4 decoration-border hover:decoration-ink-muted hover:text-ink"
              >npm</a
            ><span class="text-ink-dim">·</span>
            <a
              href="https://jsr.io/@geoql/mdr"
              target="_blank"
              rel="noopener noreferrer"
              class="underline underline-offset-4 decoration-border hover:decoration-ink-muted hover:text-ink"
              >JSR</a
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
