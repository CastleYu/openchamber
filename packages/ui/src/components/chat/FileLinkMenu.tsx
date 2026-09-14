import React from 'react';
import { toast } from 'sonner';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import { isDesktopLocalOriginActive } from '@/lib/desktop';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';

export function FileLinkMenu({ children, directory }: { children: React.ReactNode; directory: string }) {
  const { files } = useRuntimeAPIs();
  const { t } = useI18n();
  const [target, setTarget] = React.useState<{ path: string; folder: boolean } | null>(null);
  const [open, setOpen] = React.useState(false);
  const candidate = React.useRef(false);
  const abort = React.useRef<AbortController | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  React.useEffect(() => () => abort.current?.abort(), [directory]);
  const systemOpen = async (path: string) => {
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    try { await files.openNative?.(path, { directory, signal: controller.signal, onProgress: (received, total) => setProgress(total ? received / total : 0) }); }
    finally { setProgress(null); }
  };
  const run = (action: () => Promise<void>) => { void action().catch(() => toast.error(t('fileOpening.actionFailed'))); };
  return <ContextMenu open={open} onOpenChange={value => setOpen(value && candidate.current)}>
    <ContextMenuTrigger render={<div className="min-w-0" />} onContextMenuCapture={event => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-openchamber-file-link]') : null;
      candidate.current = Boolean(element);
      if (element) setTarget({ path: element.dataset.openchamberFilePath || '', folder: element.dataset.openchamberFolder === 'true' });
    }}>
      {children}
      {progress !== null && <div className="flex items-center gap-2 typography-ui"><span>{t('fileOpening.loading')}</span><progress max={1} value={progress || undefined} /><Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>{t('filesView.dialog.cancel')}</Button></div>}
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem disabled={!target || (target.folder && (!files.nativeFiles || !isDesktopLocalOriginActive()))} onClick={() => {
        if (!target) return;
        if (target.folder) run(async () => { await files.openNative?.(target.path, { directory }); });
        else useUIStore.getState().openContextFile(directory, target.path);
      }}>{t(target?.folder ? 'fileOpening.explorer' : 'fileOpening.open')}</ContextMenuItem>
      {!target?.folder && <ContextMenuItem disabled={!files.nativeFiles} onClick={() => {
        if (target) run(() => systemOpen(target.path));
      }}>{t('fileOpening.systemOpen')}</ContextMenuItem>}
      {!target?.folder && <ContextMenuItem disabled={!files.nativeFiles || !isDesktopLocalOriginActive()} onClick={() => {
        if (target) run(async () => { await files.openNative?.(target.path, { directory, reveal: true }); });
      }}>{t('fileOpening.reveal')}</ContextMenuItem>}
      <ContextMenuItem onClick={() => { if (target) run(() => navigator.clipboard.writeText(target.path)); }}>{t('openInApp.actions.copyPath')}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
