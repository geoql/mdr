const BASE = 'https://mdr.geoql.in';

export const siteJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${BASE}/#organization`,
      name: 'geoql',
      alternateName: 'MDR',
      url: BASE,
      logo: `${BASE}/og-home.png`,
      description:
        'geoql builds open-source developer tooling. MDR is a hard fork of ascorbic/macrodata that gives every AI coding agent persistent layered memory — fully local, fully offline.',
      foundingDate: '2026',
      founder: { '@id': `${BASE}/#author` },
      sameAs: [
        'https://github.com/geoql/mdr',
        'https://jsr.io/@geoql/mdr',
        'https://www.npmjs.com/package/@geoql/mdr',
      ],
    },
    {
      '@type': 'Person',
      '@id': `${BASE}/#author`,
      name: 'Vinayak Kulkarni',
      url: 'https://vinayakkulkarni.dev',
      jobTitle: 'Open-source author',
      description:
        'Open-source author building developer tooling for the AI coding-agent ecosystem.',
      knowsAbout: [
        'OpenCode',
        'Claude Code',
        'AI coding agents',
        'Persistent memory',
        'MCP',
        'Cloudflare Workers',
      ],
      sameAs: [
        'https://github.com/vinayakkulkarni',
        'https://x.com/vinayakkulkarni',
        'https://github.com/sponsors/vinayakkulkarni',
      ],
    },
    {
      '@type': 'WebSite',
      '@id': `${BASE}/#website`,
      url: BASE,
      name: 'MDR',
      description:
        'Persistent layered memory for your coding agent. A searchable journal, always-on state files, semantic search across every past session, a background daemon for reminders, and overnight self-maintenance — fully local, fully offline.',
      publisher: { '@id': `${BASE}/#organization` },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${BASE}/#software`,
      name: '@geoql/mdr',
      alternateName: 'MDR',
      url: BASE,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux',
      description:
        'A hard fork of ascorbic/macrodata by Matt Kane. Persistent, self-maintaining memory and autonomous scheduling for OpenCode and Claude Code. Runs inside the agent, no new APIs, no attack surface, nothing phones home.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@id': `${BASE}/#author` },
      publisher: { '@id': `${BASE}/#organization` },
      isBasedOn: 'https://github.com/ascorbic/macrodata',
    },
  ],
};
