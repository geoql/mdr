export function useThemeToggle() {
  const colorMode = useColorMode();
  const isDark = computed(() => colorMode.value === 'dark');

  function toggle() {
    colorMode.preference = isDark.value ? 'light' : 'dark';
  }

  if (import.meta.client) {
    watch(
      () => colorMode.value,
      (mode) => {
        document.documentElement.setAttribute('data-theme', mode);
      },
      { immediate: true },
    );
  }

  return { colorMode, isDark, toggle };
}
