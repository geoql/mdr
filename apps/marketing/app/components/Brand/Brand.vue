<script setup lang="ts">
  const { version } = useMacrodataVersion();
  withDefaults(
    defineProps<{ showWordmark?: boolean; showBadge?: boolean }>(),
    { showWordmark: true, showBadge: true },
  );
</script>

<template>
  <span class="flex items-center gap-2.5">
    <span
      class="size-6 grid shrink-0 place-items-center bg-accent text-ink-on-accent rounded-[3px] font-mono font-bold text-[14px] leading-none shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--accent)_50%,transparent),0_0_0_4px_color-mix(in_oklch,var(--accent)_15%,transparent)]"
      aria-hidden="true"
      >M</span
    >
    <span
      v-if="showWordmark"
      class="font-display text-[18px] leading-none tracking-[-0.015em]"
    >
      MDR
    </span>
    <span
      v-if="showBadge"
      class="inline-flex items-center gap-1.5 h-6 shrink-0 px-2 font-mono text-[11px] text-ink-muted bg-surface border border-border rounded-full"
    >
      <span
        aria-hidden="true"
        class="size-1.5 rounded-full bg-ok shadow-[0_0_0_3px_color-mix(in_oklch,var(--ok)_25%,transparent)]"
      />
      v{{ version }}
    </span>
  </span>
</template>
