import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  compatibilityDate: '2026-05-26',
  future: { compatibilityVersion: 5 },
  devtools: { enabled: false },

  modules: [
    '@nuxtjs/robots',
    'shadcn-nuxt',
    '@vueuse/nuxt',
    '@nuxt/icon',
    '@nuxt/eslint',
    '@nuxtjs/color-mode',
    'motion-v/nuxt',
    [
      '@nuxtjs/plausible',
      {
        domain: 'mdr.geoql.in',
        apiHost: 'https://analytics.geoql.in',
        autoOutboundTracking: true,
      },
    ],
  ],

  site: {
    url: 'https://mdr.geoql.in',
  },

  // Explicit AI-crawler allowlist (GEO). Marketing content is meant to be
  // cited, so every major generative-engine crawler is allowed.
  robots: {
    allow: ['/'],
    groups: [
      { userAgent: ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot'], allow: ['/'] },
      {
        userAgent: ['ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Claude-User'],
        allow: ['/'],
      },
      { userAgent: ['PerplexityBot', 'Perplexity-User'], allow: ['/'] },
      { userAgent: ['Google-Extended'], allow: ['/'] },
      { userAgent: ['Applebot-Extended'], allow: ['/'] },
      {
        userAgent: [
          'CCBot',
          'Bytespider',
          'meta-externalagent',
          'FacebookBot',
          'cohere-ai',
        ],
        allow: ['/'],
      },
    ],
    sitemap: ['https://mdr.geoql.in/sitemap.xml'],
  },

  css: ['~/assets/css/fonts.css', '~/assets/css/main.css'],

  // Cloudflare-local icons (no third-party api.iconify.design call at runtime).
  icon: {
    provider: 'server',
    serverBundle: 'local',
    clientBundle: {
      scan: true,
      sizeLimitKb: 512,
    },
  },

  colorMode: {
    classSuffix: '',
    preference: 'dark',
    fallback: 'dark',
  },

  app: {
    head: {
      htmlAttrs: { lang: 'en', 'data-theme': 'dark' },
      title: 'MDR — persistent layered memory for your coding agent',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'A searchable journal, always-on state files, semantic search across every past session, a background daemon for reminders, and overnight self-maintenance — fully local, fully offline, fully MIT.',
        },
        {
          name: 'theme-color',
          content: '#0a0e12',
          media: '(prefers-color-scheme: dark)',
        },
        {
          name: 'theme-color',
          content: '#f5f1ea',
          media: '(prefers-color-scheme: light)',
        },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        {
          name: 'keywords',
          content:
            'opencode plugin, claude code plugin, coding agent memory, macrodata, geoql, ascorbic, persistent memory, semantic search, scheduled reminders, local first, offline, mcp',
        },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        {
          rel: 'preconnect',
          href: 'https://data.mdr.geoql.in',
          crossorigin: '',
        },
      ],
    },
  },

  runtimeConfig: {
    public: {
      baseUrl: process.env.NUXT_PUBLIC_BASE_URL || 'https://mdr.geoql.in',
    },
  },

  nitro: {
    preset: 'cloudflare-pages',
    prerender: {
      crawlLinks: false,
      routes: ['/', '/llms.txt', '/llms-full.txt', '/og'],
      ignore: ['/og'],
    },
    routeRules: {
      '/**': {
        headers: {
          Link: '</llms.txt>; rel="llms"; type="text/plain", </llms-full.txt>; rel="llms-full"; type="text/plain", </sitemap.xml>; rel="sitemap"; type="application/xml"',
        },
      },
    },
    cloudflare: {
      // Single source of truth for the Pages config — Nitro writes
      // dist/_worker.js/wrangler.json at build time, so there is no local
      // wrangler.jsonc. No D1 binding here (marketing is static).
      deployConfig: true,
      nodeCompat: true,
      wrangler: {
        name: 'mdr-marketing',
        compatibility_date: '2026-06-16',
        compatibility_flags: ['nodejs_compat'],
      },
    },
    experimental: {
      wasm: true,
    },
    wasm: {
      esmImport: true,
      lazy: true,
    },
    rollupConfig: {
      output: {
        generatedCode: {
          constBindings: true,
        },
      },
    },
    replace: {
      'process.stdout': 'undefined',
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  vite: {
    plugins: [tailwindcss()],
  },

  experimental: {
    typedPages: true,
    viewTransition: true,
  },

  shadcn: {
    prefix: '',
    componentDir: './app/components/ui',
  },
});
