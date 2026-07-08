<script setup lang="ts">
  import { features } from '~/data/landing';
  import { usePageSeo } from '~/composables/use-page-seo';

  usePageSeo({
    title: 'MDR — persistent layered memory for your coding agent',
    description:
      'A searchable journal, always-on state files, semantic search across every past session, a background daemon for reminders, and overnight self-maintenance. Fully local, fully offline, fully MIT. Hard fork of ascorbic/macrodata by Matt Kane.',
    path: '/',
  });

  void features;
</script>

<template>
  <div class="min-h-dvh bg-bg text-ink">
    <SiteNav />

    <Hero
      kicker="OpenCode · Claude Code · MIT"
      headline-a="Memory"
      headline-b-italic="refinement"
      headline-c="for your agent."
      lede="A searchable journal, always-on state, semantic search across every past session, a background daemon, scheduled reminders, overnight self-maintenance —"
      lede-strong="everything your agent needs to remember"
      install-snippet='"plugin": ["@geoql/mdr@latest"]'
      :cta-primary="{
        label: 'Install for OpenCode',
        href: 'https://github.com/geoql/mdr#installation',
      }"
      :cta-secondary="{ label: 'Read the architecture', href: '#architecture' }"
    />

    <FeatureTriad
      kicker="What it does"
      title="Six layers. One memory."
      sub="Every session starts with context injection — identity, projects, daily focus. Every session can write back. Nothing is lost between runs, nothing phones home, nothing needs an account."
    />

    <ArchitectureDiagram
      kicker="How it fits"
      title="The plugin, the daemon, the disk."
      sub="OpenCode or Claude Code loads the plugin; the plugin reads from state/, journal/, entities/, and the .index/. The daemon supervises scheduled agent children with a heartbeat so a stale process can self-heal on the next session."
    />

    <InstallSection
      kicker="Get it running"
      title="One line in opencode.json."
      sub="Restart your agent and ask it to set up Macrodata. The onboarding skill takes it from there — identity, human profile, first project, first journal entry — without touching the network."
    />

    <ForkCredit
      kicker="Credit"
      title="A fork, with respect."
      body="The layered-memory architecture, the tools, the skills, and the design are Matt Kane's work. @geoql/mdr stands entirely on that foundation — Node runtime, hardened daemon, full coverage, geoql release automation. The data directory, MCP server id, and tool names are unchanged from upstream, so an existing install keeps its memories."
      upstream-href="https://github.com/ascorbic/macrodata"
      upstream-name="ascorbic/macrodata"
      upstream-author-href="https://github.com/ascorbic"
      upstream-author-name="Matt Kane"
      fork-href="https://github.com/geoql/mdr/fork"
      fork-label="Fork on GitHub"
    />

    <SiteFooter />
  </div>
</template>
