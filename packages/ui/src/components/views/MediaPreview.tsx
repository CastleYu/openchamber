import { ImagePreview } from './ImagePreview';
import React from 'react';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useI18n } from '@/lib/i18n';
import { mediaKind } from '@/lib/fileKinds';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import type { FileAsset, FileTransferOptions, ArchiveEntry } from '@/lib/api/types';

type State = { status: 'loading'; received: number; total?: number } | { status: 'ready'; url: string } | { status: 'error' };

export function MediaPreview({ path, options }: { path: string; options: FileTransferOptions }) {
  const { files } = useRuntimeAPIs();
  const { t } = useI18n();
  const [state, setState] = React.useState<State>({ status: 'loading', received: 0 });
  const [attempt, retry] = React.useReducer(n => n + 1, 0);
  const [entries, setEntries] = React.useState<ArchiveEntry[]>([]);
  const abort = React.useRef<AbortController | null>(null);
  const kind = mediaKind(path);
  const { directory, outsideFileGrant, allowOutsideWorkspace } = options;
  React.useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    let asset: FileAsset | undefined;
    setState({ status: 'loading', received: 0 });
    const load = async () => {
      const opts = { directory, outsideFileGrant, allowOutsideWorkspace, signal: controller.signal, onProgress: (received: number, total?: number) => {
        if (!controller.signal.aborted) setState({ status: 'loading', received, total });
      } };
      if (kind === 'zip') {
        if (!files.archiveEntries) throw new Error('Archive preview unavailable');
        const result = await files.archiveEntries(path, opts);
        if (!controller.signal.aborted) { setEntries(result); setState({ status: 'ready', url: '' }); }
        return;
      }
      if (!files.loadAsset) throw new Error('Media preview unavailable');
      asset = await files.loadAsset(path, opts);
      if (controller.signal.aborted) { asset.dispose(); asset = undefined; return; }
      setState({ status: 'ready', url: asset.url });
    };
    void load().catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }); });
    return () => { controller.abort(); asset?.dispose(); };
  }, [files, path, kind, directory, outsideFileGrant, allowOutsideWorkspace, attempt]);

  if (state.status === 'loading') return <div className="p-4 space-y-3 typography-ui">
    <p>{t('fileOpening.loading')}</p>
    <progress className="w-full accent-primary" max={state.total || undefined} value={state.total ? state.received : undefined} aria-label={t('fileOpening.loading')} />
    <p className="text-muted-foreground">{(state.received / 1048576).toFixed(1)} MB{state.total ? ` / ${(state.total / 1048576).toFixed(1)} MB` : ''}</p>
    <Button size="sm" variant="outline" onClick={() => { abort.current?.abort(); setState({ status: 'error' }); }}>{t('filesView.dialog.cancel')}</Button>
  </div>;
  if (state.status === 'error') return <div className="p-4 space-y-3 typography-ui">
    <p>{t('fileOpening.previewFailed')}</p>
    <Button size="sm" variant="outline" onClick={retry}>{t('fileOpening.retry')}</Button>
  </div>;
  if (kind === 'image') return <ImagePreview src={state.url} name={path.replace(/\\/g, '/').split('/').pop() || path} />;
  if (kind === 'pdf') return <iframe src={state.url} title={path} className="h-full min-h-96 w-full border-0" />;
  if (kind === 'zip') return <div className="p-3 overflow-auto h-full typography-ui">
    <p className="mb-3 text-muted-foreground">{t('fileOpening.archiveReadOnly')}</p>
    <table className="w-full text-left"><thead><tr><th>{t('fileOpening.name')}</th><th>{t('fileOpening.size')}</th><th>{t('fileOpening.compressed')}</th></tr></thead>
      <tbody>{entries.map((entry, index) => <tr key={index} className="border-b border-border"><td className="py-1 break-all"><Icon name={entry.directory ? 'folder' : 'file-text'} className="inline size-4 mr-2" />{entry.name}</td><td className="whitespace-nowrap tabular-nums">{entry.size.toLocaleString()}</td><td className="whitespace-nowrap tabular-nums">{entry.compressedSize.toLocaleString()}</td></tr>)}</tbody>
    </table>
  </div>;
  return <div className="flex h-full min-h-48 flex-col items-center justify-center gap-4 p-4">
    {kind === 'audio' ? <>
      <Icon name="volume-up" className="size-10 text-muted-foreground" />
      <p className="typography-ui text-center break-all">{path.replace(/\\/g, '/').split('/').pop()}</p>
      <audio key={state.url} src={state.url} controls preload="metadata" className="w-full max-w-xl" onError={() => setState({ status: 'error' })} />
    </> : <video key={state.url} src={state.url} controls playsInline preload="metadata" className="w-full max-h-[75vh]" onError={() => setState({ status: 'error' })} />}
  </div>;
}
