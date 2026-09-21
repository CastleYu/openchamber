import React from 'react';
import { toast } from 'sonner';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useI18n } from '@/lib/i18n';
import { copyTextToClipboard } from '@/lib/clipboard';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { isMobileSurfaceRuntime } from '@/lib/runtimeSurface';
import type { ToolPopupContent } from '../message/types';
import { diagramPng, saveBlob } from './diagramExport';
import { getMermaidViewerController } from './mermaidViewer';

const ToolOutputDialog = lazyWithChunkRecovery(() => import('../message/ToolOutputDialog'));

interface DiagramMenuProps {
  children: React.ReactNode;
  onShowPopup?: (content: ToolPopupContent) => void;
  expanded?: boolean;
}

type DiagramTarget = {
  block: HTMLElement;
  source: string;
  language: 'mermaid' | 'plantuml';
  svg: string | null;
};

const readTarget = (node: EventTarget | null): DiagramTarget | null => {
  if (!(node instanceof Element)) return null;
  const block = node.closest<HTMLElement>('[data-markdown="mermaid-block"]');
  if (!block) return null;
  const source = block.getAttribute('data-md-source') ?? '';
  const language = block.getAttribute('data-diagram-language') === 'plantuml' ? 'plantuml' : 'mermaid';
  const svgHost = block.querySelector<HTMLElement>('[data-markdown="mermaid"]');
  return {
    block,
    source,
    language,
    svg: svgHost?.getAttribute('data-md-original-svg') ?? null,
  };
};

const popupFor = (target: DiagramTarget, title: string): ToolPopupContent => {
  const filename = target.language === 'plantuml' ? 'diagram.puml' : 'diagram.mmd';
  return {
    open: true,
    title,
    content: '',
    metadata: { tool: 'mermaid-preview', filename },
    mermaid: {
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(target.source)}`,
      source: target.source,
      filename,
      language: target.language,
    },
  };
};

export function DiagramMenu({ children, onShowPopup, expanded = false }: DiagramMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [target, setTarget] = React.useState<DiagramTarget | null>(null);
  const [popup, setPopup] = React.useState<ToolPopupContent | null>(null);
  const candidate = React.useRef(false);

  const runExport = React.useCallback((action: () => Promise<void>) => {
    void action().catch(() => toast.error(t('markdownRenderer.diagram.exportFailed')));
  }, [t]);

  const showPopup = React.useCallback(() => {
    if (!target || expanded || !target.source.trim()) return;
    const content = popupFor(target, t('layout.mainTab.diagram'));
    if (onShowPopup) onShowPopup(content);
    else setPopup(content);
  }, [expanded, onShowPopup, t, target]);

  return (
    <>
      <ContextMenu open={open} onOpenChange={(value) => setOpen(value && candidate.current)}>
        <ContextMenuTrigger
          render={<div className="contents" />}
          onContextMenu={(event) => {
            const next = readTarget(event.target);
            candidate.current = next !== null;
            if (next) setTarget(next);
            else event.preventBaseUIHandler();
          }}
          onClick={(event) => {
            if (expanded || onShowPopup || !(event.target instanceof Element)) return;
            if (event.target.closest('button, a, [role="button"]')) return;
            const next = readTarget(event.target);
            if (!next?.svg) return;
            if (next.block.hasAttribute('data-mermaid-suppress-click')) {
              next.block.removeAttribute('data-mermaid-suppress-click');
              return;
            }
            setPopup(popupFor(next, t('layout.mainTab.diagram')));
          }}
        >
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent>
          {!expanded && (
            <ContextMenuItem disabled={!target?.source.trim()} onClick={showPopup}>
              {t('chat.messageBody.actions.openPreview')}
            </ContextMenuItem>
          )}
          <ContextMenuItem disabled={!target?.svg} onClick={() => target && getMermaidViewerController(target.block)?.fit()}>
            {t('markdownRenderer.mermaid.actions.resetViewTitle')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!target?.source.trim()}
            onClick={() => {
              if (target) void copyTextToClipboard(target.source);
            }}
          >
            {t('markdownRenderer.mermaid.actions.copySourceTitle')}
          </ContextMenuItem>
          {target?.language === 'plantuml' && (
            <ContextMenuItem
              disabled={!target.source.trim()}
              onClick={() => target && saveBlob(new Blob([target.source], { type: 'text/plain;charset=utf-8' }), 'diagram.puml')}
            >
              {t('markdownRenderer.diagram.downloadSource')}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            disabled={!target?.svg}
            onClick={() => {
              if (target?.svg) saveBlob(new Blob([target.svg], { type: 'image/svg+xml;charset=utf-8' }), 'diagram.svg');
            }}
          >
            {t('markdownRenderer.mermaid.actions.downloadSvgTitle')}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!target?.svg}
            onClick={() => {
              const svg = target?.svg;
              if (svg) runExport(async () => saveBlob(await diagramPng(svg), 'diagram.png'));
            }}
          >
            {t('markdownRenderer.diagram.downloadPng')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {!onShowPopup && popup && (
        <React.Suspense fallback={null}>
          <ToolOutputDialog popup={popup} onOpenChange={(value) => { if (!value) setPopup(null); }} isMobile={isMobileSurfaceRuntime()} />
        </React.Suspense>
      )}
    </>
  );
}
