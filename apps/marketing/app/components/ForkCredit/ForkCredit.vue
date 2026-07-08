<script setup lang="ts">
  defineProps<{
    kicker: string;
    title: string;
    body: string;
    upstreamHref: string;
    upstreamName: string;
    upstreamAuthorHref: string;
    upstreamAuthorName: string;
    forkHref: string;
    forkLabel: string;
  }>();
</script>

<template>
  <section
    id="fork"
    class="border-t border-border-soft py-20 lg:py-24"
  >
    <div class="mx-auto max-w-330 px-5 lg:px-8">
      <div
        class="rounded-lg border border-border bg-surface p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center"
      >
        <div class="max-w-[68ch]">
          <span
            class="font-mono text-[11.5px] tracking-[0.14em] uppercase text-ink-muted"
            >{{ kicker }}</span
          >
          <h2
            class="font-display font-400 italic text-ink leading-[1.05] tracking-[-0.02em] mt-3 mb-4 text-[clamp(28px,3.4vw,40px)]"
          >
            {{ title }}
          </h2>
          <p
            class="text-ink-muted text-[15px] lg:text-[16px] leading-[1.65] m-0"
          >
            {{ body }}
          </p>

          <div class="flex items-center gap-3 flex-wrap mt-6">
            <a
              :href="upstreamHref"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-2 px-4 h-10 rounded-md bg-accent text-ink-on-accent font-medium text-[14px] tracking-[-0.01em] hover:brightness-105 transition-[filter] duration-120"
            >
              <Icon name="lucide:github" class="size-4" />
              {{ upstreamName }}
            </a>
            <a
              :href="forkHref"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-2 px-4 h-10 rounded-md border border-border bg-bg text-ink text-[14px] tracking-[-0.01em] hover:border-ink-muted transition-colors duration-120"
            >
              <Icon name="lucide:git-fork" class="size-4" />
              {{ forkLabel }}
            </a>
            <a
              :href="upstreamAuthorHref"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-ink-muted text-[13.5px] hover:text-ink transition-colors duration-120"
            >
              <Icon name="lucide:user" class="size-3.5" />
              {{ upstreamAuthorName }}
            </a>
          </div>
        </div>

        <div
          class="relative aspect-square w-45 lg:w-55 rounded-md border border-border bg-bg overflow-hidden shrink-0 self-center"
        >
          <div
            class="absolute inset-0 dot-grid opacity-60 pointer-events-none"
          />
          <div class="relative h-full grid place-items-center">
            <span
              class="font-display italic text-accent leading-none text-[clamp(80px,12vw,140px)]"
              style="text-shadow: 0 0 32px color-mix(in oklch, var(--accent) 35%, transparent);"
              >M</span
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
