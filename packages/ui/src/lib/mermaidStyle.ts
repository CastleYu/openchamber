export const MERMAID_STYLES = [
  'openchamber',
  'native',
  'forest',
  'neutral',
  'hand-drawn',
  'github-light',
  'github-dark',
  'nord',
  'tokyo-night',
] as const;

export type MermaidStyle = (typeof MERMAID_STYLES)[number];
