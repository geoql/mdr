<script setup lang="ts">
  import { useThemeToggle } from '~/composables/use-theme-toggle';

  const { isDark, toggle } = useThemeToggle();
</script>

<template>
  <button
    type="button"
    class="grid place-items-center size-9 rounded-md border border-border text-ink-muted transition-colors duration-120 bg-surface hover:text-ink hover:border-ink-muted"
    :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="toggle"
  >
    <Icon v-if="isDark" name="lucide:sun" class="size-4" />
    <Icon v-else name="lucide:moon" class="size-4" />
  </button>
</template>
