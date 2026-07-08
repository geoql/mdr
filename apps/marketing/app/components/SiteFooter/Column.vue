<script setup lang="ts">
  import type { FooterColumn } from '~/types';

  defineProps<{
    column: FooterColumn;
  }>();
</script>

<template>
  <div>
    <h5
      class="font-mono text-[11px] tracking-[0.14em] uppercase text-ink-muted m-0 mb-3 font-medium"
    >
      {{ column.title }}
    </h5>
    <ul class="list-none p-0 m-0 flex flex-col gap-2 text-[14px]">
      <li v-for="link in column.links" :key="link.href">
        <a
          v-if="link.external"
          :href="link.href"
          target="_blank"
          rel="noopener noreferrer"
          class="text-ink-muted transition-colors duration-120 hover:text-ink"
          >{{ link.label }}</a
        >
        <NuxtLink
          v-else
          :to="link.href"
          class="text-ink-muted transition-colors duration-120 hover:text-ink"
          >{{ link.label }}</NuxtLink
        >
      </li>
    </ul>
  </div>
</template>
