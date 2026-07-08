<script setup lang="ts">
  import type { NavLink } from '~/types';

  defineProps<{
    links: readonly NavLink[];
  }>();
  const emit = defineEmits<{
    close: [];
  }>();

  function onLinkClick() {
    emit('close');
  }
</script>

<template>
  <div
    class="md:hidden border-t border-border-soft bg-bg px-5 py-4 flex flex-col gap-1"
  >
    <NuxtLink
      v-for="link in links"
      :key="link.href"
      :to="link.external ? undefined : link.href"
      :href="link.external ? link.href : undefined"
      :target="link.external ? '_blank' : undefined"
      :rel="link.external ? 'noopener noreferrer' : undefined"
      class="py-2.5 text-[15px] text-ink-muted hover:text-ink"
      @click="onLinkClick"
      >{{ link.label }}</NuxtLink
    >
  </div>
</template>
