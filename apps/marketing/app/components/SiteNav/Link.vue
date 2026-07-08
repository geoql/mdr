<script setup lang="ts">
  import type { NavLink } from '~/types';

  defineProps<{
    link: NavLink;
  }>();
</script>

<template>
  <a
    v-if="link.external"
    :href="link.href"
    target="_blank"
    rel="noopener noreferrer"
    class="px-2.5 py-1.5 text-[13.5px] text-ink-muted rounded-md transition-colors duration-120 hover:text-ink hover:bg-surface"
    >{{ link.label }}</a
  >
  <NuxtLink
    v-else
    :to="link.href"
    class="px-2.5 py-1.5 text-[13.5px] text-ink-muted rounded-md transition-colors duration-120 hover:text-ink hover:bg-surface"
    >{{ link.label }}</NuxtLink
  >
</template>
