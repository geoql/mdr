<script setup lang="ts">
  import { siteJsonLd } from '~/data/site-schema';

  useHead({
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify(siteJsonLd),
      },
    ],
  });
</script>

<template>
  <NuxtPage />
</template>
