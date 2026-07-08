import type { NavLink } from '~/types';

export const navLinks: readonly NavLink[] = [
  { label: 'Layers', href: '/#layers', external: false },
  { label: 'Architecture', href: '/#architecture', external: false },
  { label: 'Install', href: '/#install', external: false },
  { label: 'Fork', href: '/#fork', external: false },
  {
    label: 'GitHub',
    href: 'https://github.com/geoql/mdr',
    external: true,
  },
] as const;
