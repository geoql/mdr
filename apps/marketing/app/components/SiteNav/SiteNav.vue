<script setup lang="ts">
  import { navLinks } from '~/data/site-nav';

  const mobileOpen = ref(false);
</script>

<template>
  <header
    class="nav-blur sticky top-0 z-50 border-b border-border-soft"
  >
    <div class="mx-auto flex h-15 max-w-330 items-center gap-6 px-5 lg:px-8">
      <NuxtLink to="/">
        <Brand />
      </NuxtLink>

      <nav
        class="ml-auto hidden items-center gap-1 md:flex"
        aria-label="primary"
      >
        <SiteNavLink v-for="link in navLinks" :key="link.href" :link="link" />
        <ThemeToggle class="ml-1" />
      </nav>

      <div class="ml-auto flex items-center gap-2 md:hidden">
        <ThemeToggle />
        <button
          type="button"
          class="grid place-items-center size-8 text-ink-muted"
          :aria-label="mobileOpen ? 'Close menu' : 'Open menu'"
          @click="mobileOpen = !mobileOpen"
        >
          <Icon
            v-if="!mobileOpen"
            name="lucide:menu"
            class="size-5"
          />
          <Icon v-else name="lucide:x" class="size-5" />
        </button>
      </div>
    </div>

    <SiteNavMobileMenu
      v-if="mobileOpen"
      :links="navLinks"
      @close="mobileOpen = false"
    />
  </header>
</template>
