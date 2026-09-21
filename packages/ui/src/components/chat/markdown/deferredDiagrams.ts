import type { MermaidStyle } from '@/lib/mermaidStyle';

export type DeferredDiagram = { svg: string; pending?: never; failed?: never }
  | { svg?: never; pending: true; failed?: never }
  | { svg?: never; pending?: never; failed: true };

export const DIAGRAM_CODE_SELECTOR = 'pre > code.language-mermaid, pre > code.language-plantuml, pre > code.language-puml';
export const DIAGRAM_PENDING_SELECTOR = '[data-diagram-pending]';
const PENDING: DeferredDiagram = { pending: true };
const FAILED: DeferredDiagram = { failed: true };

export const isNativeMermaid = (style: MermaidStyle) => (
  style === 'native' || style === 'forest' || style === 'neutral' || style === 'hand-drawn'
);

type DiagramEngines = typeof import('./diagramEngines');
const loadEngines = () => import('./diagramEngines');

/** Results belong only to this renderer's current source, theme and style. */
export const createDeferredDiagrams = (
  style: MermaidStyle,
  dark: boolean,
  background: string,
  load: () => Promise<DiagramEngines> = loadEngines,
) => {
  let results = new Map<string, DeferredDiagram>();
  let revision = 0;
  const key = (source: string, plantuml: boolean) => `${plantuml ? 'puml' : 'mermaid'}\0${source.replace(/\s+$/, '')}`;
  const read = (source: string, plantuml: boolean): DeferredDiagram => results.get(key(source, plantuml)) ?? PENDING;

  const prepare = (blocks: readonly { html: string }[]): Promise<void> | null => {
    const sources = new Map<string, { source: string; plantuml: boolean }>();
    for (const block of blocks) {
      if (!/language-(?:plantuml|puml)/.test(block.html) && !(isNativeMermaid(style) && block.html.includes('language-mermaid'))) continue;
      const root = document.createElement('div');
      root.innerHTML = block.html;
      for (const code of root.querySelectorAll(DIAGRAM_CODE_SELECTOR)) {
        const plantuml = !code.classList.contains('language-mermaid');
        if (!plantuml && !isNativeMermaid(style)) continue;
        const source = (code.textContent ?? '').replace(/\s+$/, '');
        sources.set(key(source, plantuml), { source, plantuml });
      }
    }
    if (!sources.size) {
      revision += 1;
      results.clear();
      return null;
    }
    const current = ++revision;
    const previous = results;
    return (async () => {
      const next = new Map<string, DeferredDiagram>();
      const engines = await load();
      for (const [id, entry] of sources) {
        if (revision !== current) return;
        const existing = previous.get(id);
        if (existing) {
          next.set(id, existing);
          continue;
        }
        try {
          const svg = entry.plantuml
            ? await engines.renderPlantUml(entry.source, dark, background)
            : await engines.renderNativeMermaid(entry.source, isNativeMermaid(style) ? style : 'native', dark);
          next.set(id, { svg });
        } catch {
          next.set(id, FAILED);
        }
      }
      if (revision === current) results = next;
    })().catch(() => {
      if (revision === current) results = new Map([...sources.keys()].map((id) => [id, FAILED]));
    });
  };
  const cancel = () => { revision += 1; };
  return { read, prepare, cancel };
};
