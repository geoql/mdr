export interface NavLink {
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
}

export interface FooterLink {
  readonly label: string;
  readonly href: string;
  readonly external: boolean;
}

export interface FooterColumn {
  readonly title: string;
  readonly links: readonly FooterLink[];
}

export interface Feature {
  readonly key: string;
  readonly num: string;
  readonly title: string;
  readonly body: string;
  readonly icon: 'journal' | 'layers' | 'state' | 'search' | 'daemon' | 'cron';
  readonly pills?: readonly string[];
}

export interface ArchitectureNode {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
}

export interface ArchitectureEdge {
  readonly from: string;
  readonly to: string;
}
