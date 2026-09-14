import React from 'react';
import { toast } from 'sonner';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useI18n } from '@/lib/i18n';
import { useOpenInAppsStore } from '@/stores/useOpenInAppsStore';
import { isDesktopLocalOriginActive, invokeDesktop } from '@/lib/desktop';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { FileTransferOptions } from '@/lib/api/types';

type FileAction = (signal: AbortSignal, onProgress: (received: number, total?: number) => void) => Promise<void>;
const CHOOSE_APP = 'desktop_choose_file_app';

export function FileActions({ path, options = {}, content, dirty, save }: {
  path: string; options?: FileTransferOptions; content?: string; dirty?: boolean; save?: () => Promise<void>;
}) {
  const { files } = useRuntimeAPIs();
  const { t } = useI18n();
  const apps = useOpenInAppsStore(s => s.availableApps);
  const initialize = useOpenInAppsStore(s => s.initialize);
  const refresh = useOpenInAppsStore(s => s.loadInstalledApps);
  const [pending, setPending] = React.useState<{ action: FileAction } | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  React.useEffect(() => { initialize(); }, [initialize]);
  React.useEffect(() => () => { abort.current?.abort(); abort.current = null; }, [path]);
  const run = async (action: FileAction) => {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    try { await action(controller.signal, (received, total) => {
      if (!controller.signal.aborted) setProgress(total ? received / total : 0);
    }); }
    catch { if (!controller.signal.aborted) toast.error(t('fileOpening.actionFailed')); }
    finally {
      if (abort.current === controller) {
        abort.current = null;
        setProgress(null);
      }
    }
  };
  const confirmOpen = (action: FileAction) => {
    if (dirty) setPending({ action }); else void run(action);
  };
  const open = (app?: { id: string; appName: string }) => {
    confirmOpen(async (signal, onProgress) => {
      if (!files.openNative) throw new Error('Native file opening is unavailable');
      await files.openNative(path, { ...options, app, signal, onProgress });
    });
  };
  if (!files.nativeFiles) return null;
  return <div className="ml-auto flex shrink-0 items-center gap-1">
    {progress !== null && <><progress className="w-16" max={1} value={progress || undefined} aria-label={t('fileOpening.loading')} /><Button variant="ghost" size="sm" onClick={() => abort.current?.abort()}>{t('filesView.dialog.cancel')}</Button></>}
    <Button variant="ghost" size="sm" disabled={progress !== null || !files.saveAs} onClick={() => void run(async (signal, onProgress) => {
      if (await files.saveAs?.(path, { ...options, content, signal, onProgress }) && !signal.aborted) toast.success(t('fileOpening.saved'));
    })}><Icon name="download" className="size-4 mr-1" />{t('fileOpening.saveAs')}</Button>
    <Button variant="outline" size="sm" disabled={progress !== null} onClick={() => open()}><Icon name="external-link" className="size-4 mr-1" />{t('fileOpening.systemOpen')}</Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={progress !== null} aria-label={t('fileOpening.chooseApp')}><Icon name="arrow-down-s" className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => open()}>{t('fileOpening.systemOpen')}</DropdownMenuItem>
        {isDesktopLocalOriginActive() && <>
          {apps.filter(app => app.id !== 'finder' && app.id !== 'terminal').map(app => <DropdownMenuItem key={app.id} onClick={() => open(app)}>{app.label}</DropdownMenuItem>)}
          <DropdownMenuItem onClick={() => void run(async (signal) => { await files.openNative?.(path, { ...options, reveal: true, signal }); })}>{t('fileOpening.reveal')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => confirmOpen(async (signal) => { signal.throwIfAborted(); await invokeDesktop(CHOOSE_APP, { path }); })}>{t('fileOpening.chooseApp')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void refresh(true)}>{t('filesView.editor.refreshApps')}</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={Boolean(pending)} onOpenChange={open => { if (!open) setPending(null); }}><DialogContent>
      <DialogTitle>{t('fileOpening.unsaved')}</DialogTitle>
      <DialogFooter>
        <Button variant="outline" onClick={() => setPending(null)}>{t('filesView.dialog.cancel')}</Button>
        <Button variant="outline" onClick={() => { const action = pending?.action; setPending(null); if (action) void run(action); }}>{t('fileOpening.openDisk')}</Button>
        <Button disabled={!save} onClick={() => {
          const action = pending?.action;
          setPending(null);
          if (action && save) void run(async (signal, onProgress) => {
            await save();
            signal.throwIfAborted();
            await action(signal, onProgress);
          });
        }}>{t('fileOpening.saveOpen')}</Button>
      </DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
