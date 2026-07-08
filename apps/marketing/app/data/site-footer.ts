import type { FooterColumn } from '~/types';

export const footerColumns: readonly FooterColumn[] = [
  {
    title: 'Layers',
    links: [
      { label: 'Journal', href: '/#layers', external: false },
      { label: 'Entities', href: '/#layers', external: false },
      { label: 'State files', href: '/#layers', external: false },
      { label: 'Semantic search', href: '/#layers', external: false },
      { label: 'Background daemon', href: '/#layers', external: false },
      { label: 'Scheduled reminders', href: '/#layers', external: false },
    ],
  },
  {
    title: 'Get it',
    links: [
      {
        label: 'npm',
        href: 'https://www.npmjs.com/package/@geoql/mdr',
        external: true,
      },
      {
        label: 'JSR',
        href: 'https://jsr.io/@geoql/mdr',
        external: true,
      },
      {
        label: 'GitHub',
        href: 'https://github.com/geoql/mdr',
        external: true,
      },
      {
        label: 'Upstream',
        href: 'https://github.com/ascorbic/macrodata',
        external: true,
      },
    ],
  },
  {
    title: 'Project',
    links: [
      {
        label: 'Hard fork of ascorbic/macrodata',
        href: '/#fork',
        external: false,
      },
      {
        label: 'Changelog',
        href: 'https://github.com/geoql/mdr/releases',
        external: true,
      },
      {
        label: 'Vinayak Kulkarni',
        href: 'https://vinayakkulkarni.dev',
        external: true,
      },
    ],
  },
] as const;
