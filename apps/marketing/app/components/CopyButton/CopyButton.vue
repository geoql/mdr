<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      text: string;
      label?: string;
      successLabel?: string;
    }>(),
    { label: 'Copy', successLabel: 'Copied' },
  );

  const copied = ref(false);
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  async function copy() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(props.text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = props.text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      copied.value = true;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        copied.value = false;
      }, 1400);
    } catch {
      // clipboard not available — leave button unchanged.
    }
  }
</script>

<template>
  <button
    type="button"
    :aria-label="copied ? successLabel : label"
    :class="[
      'inline-flex items-center gap-1.5 h-8 px-3 font-mono text-[12px] rounded-sm border border-border transition-colors duration-120',
      copied
        ? 'text-ok'
        : 'text-ink bg-surface-2 hover:bg-[color-mix(in_oklch,var(--ink)_8%,var(--surface-2))]',
      copied && 'border-[color-mix(in_oklch,var(--ok)_40%,var(--border))]',
    ]"
    @click="copy"
  >
    <Icon v-if="!copied" name="lucide:copy" class="size-3" />
    <Icon v-else name="lucide:check" class="size-3" />
    <span>{{ copied ? successLabel : label }}</span>
  </button>
</template>
