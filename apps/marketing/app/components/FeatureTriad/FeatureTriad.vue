<script setup lang="ts">
  import { features } from '~/data/landing';
  import type { Feature } from '~/types';

  defineProps<{
    kicker: string;
    title: string;
    sub: string;
  }>();

  function iconFor(key: Feature['icon']): string {
    switch (key) {
      case 'journal':
        return 'lucide:notebook-text';
      case 'layers':
        return 'lucide:layers';
      case 'state':
        return 'lucide:file-stack';
      case 'search':
        return 'lucide:search';
      case 'daemon':
        return 'lucide:server';
      case 'cron':
        return 'lucide:alarm-clock';
    }
  }
</script>

<template>
  <section id="layers" class="border-t border-border-soft py-24 lg:py-32">
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

      <div
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border-soft border border-border rounded-lg overflow-hidden"
      >
        <article
          v-for="f in features"
          :key="f.key"
          class="bg-surface p-7 lg:p-8 flex flex-col gap-4 transition-colors duration-120 hover:bg-surface-2"
        >
          <div class="flex items-center justify-between">
            <Icon :name="iconFor(f.icon)" class="size-5 text-accent" />
            <span
              class="font-data text-[11.5px] text-ink-dim tracking-[0.14em] uppercase"
              >{{ f.num }}</span
            >
          </div>
          <h3
            class="font-sans font-semibold text-ink text-xl/tight tracking-[-0.012em] m-0"
          >
            {{ f.title }}
          </h3>
          <p class="text-ink-muted text-[14.5px] leading-[1.6] m-0">
            {{ f.body }}
          </p>
          <div
            v-if="f.pills"
            class="flex items-center gap-1.5 flex-wrap mt-auto pt-2"
          >
            <span
              v-for="pill in f.pills"
              :key="pill"
              class="font-data text-[11px] text-ink-dim px-2 py-1 border border-border-soft rounded"
            >
              {{ pill }}
            </span>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
