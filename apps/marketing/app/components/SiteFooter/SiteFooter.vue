<script setup lang="ts">
  import { footerColumns } from '~/data/site-footer';

  const year = new Date().getFullYear();
</script>

<template>
  <footer class="border-t border-border-soft pt-14 pb-12 text-ink-dim">
    <div
      class="mx-auto max-w-330 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_repeat(3,1fr)] gap-8 px-5 lg:px-8"
    >
      <div class="flex flex-col gap-3">
        <NuxtLink to="/">
          <Brand />
        </NuxtLink>
        <p class="text-ink-muted text-[14px] max-w-[36ch]">
          Persistent layered memory for your coding agent. Fully local, fully
          offline, fully MIT. A hard fork of ascorbic/macrodata by Matt Kane.
        </p>
      </div>

      <SiteFooterColumn
        v-for="column in footerColumns"
        :key="column.title"
        :column="column"
      />
    </div>

    <div
      class="mx-auto max-w-330 mt-10 flex flex-wrap items-center justify-between gap-2 pt-6 px-5 lg:px-8 border-t border-border-soft font-mono text-[11.5px]"
    >
      <span>
        <span
          class="inline-block size-1.5 rounded-full bg-ok mr-2 align-middle shadow-[0_0_0_3px_color-mix(in_oklch,var(--ok)_20%,transparent)]"
        />
        local-first · offline · MIT
      </span>
      <span>© {{ year }} geoql · fork of ascorbic/macrodata</span>
    </div>
  </footer>
</template>
