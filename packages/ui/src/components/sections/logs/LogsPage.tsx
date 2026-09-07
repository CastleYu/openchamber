import React from 'react';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
  canUseElectronDesktopIPC,
  isDesktopLocalOriginActive,
  openDesktopPath,
  revealDesktopPath,
} from '@/lib/desktop';
import { getCurrentIntlLocale, useI18n } from '@/lib/i18n';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { cn } from '@/lib/utils';
import type { LogFileInfo, LogsInfo } from '@/lib/api/types';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection, SettingsFieldRow } from '@/components/sections/shared/SettingsSection';
import { SettingsInfoHint } from '@/components/sections/shared/SettingsInfoHint';

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatModifiedAt = (modifiedAt: number): string => (
  new Intl.DateTimeFormat(getCurrentIntlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(modifiedAt)
);

export const LogsPage: React.FC = () => {
  const { t } = useI18n();
  const runtimeApis = useRuntimeAPIs();

  const [logsInfo, setLogsInfo] = React.useState<LogsInfo | null>(null);
  const [isLoadFailed, setIsLoadFailed] = React.useState(false);
  const [busyFile, setBusyFile] = React.useState<string | null>(null);

  const diagnostics = runtimeApis.diagnostics ?? null;
  const logDirectory = logsInfo?.directory ?? null;
  // "Open with the default program" needs the log file on this machine: the
  // desktop shell (in-process server, local origin) or the VS Code host
  // (server and extension host share the machine). Remote web sessions can
  // only download.
  const desktopLocal = canUseElectronDesktopIPC() && isDesktopLocalOriginActive();
  const canOpenWithDefaultProgram = Boolean(desktopLocal || runtimeApis.vscode?.openLocalPath);
  const canRevealFolder = Boolean(desktopLocal);

  const loadLogsInfo = React.useCallback(async () => {
    if (!diagnostics) {
      setIsLoadFailed(true);
      return;
    }
    try {
      setLogsInfo(await diagnostics.getLogsInfo());
      setIsLoadFailed(false);
    } catch {
      setIsLoadFailed(true);
    }
  }, [diagnostics]);

  React.useEffect(() => {
    void loadLogsInfo();
  }, [loadLogsInfo]);

  const handleCopyPath = React.useCallback(async () => {
    if (!logDirectory) return;
    const result = await copyTextToClipboard(logDirectory);
    if (result.ok) {
      toast.success(t('settings.logs.copied'));
    } else {
      toast.error(t('settings.logs.copyFailed'));
    }
  }, [logDirectory, t]);

  const handleOpenWithDefaultProgram = React.useCallback(async (filePath: string) => {
    if (desktopLocal) {
      const opened = await openDesktopPath(filePath);
      if (!opened) toast.error(t('settings.logs.openFailed'));
      return;
    }
    if (runtimeApis.vscode?.openLocalPath) {
      try {
        await runtimeApis.vscode.openLocalPath(filePath);
      } catch {
        toast.error(t('settings.logs.openFailed'));
      }
      return;
    }
    toast.error(t('settings.logs.openFailed'));
  }, [desktopLocal, runtimeApis.vscode, t]);

  const handleRevealFolder = React.useCallback(async (filePath: string) => {
    const revealed = await revealDesktopPath(filePath);
    if (!revealed) toast.error(t('settings.logs.openFailed'));
  }, [t]);

  const handleDownload = React.useCallback(async (fileName?: string) => {
    if (!diagnostics) return;
    setBusyFile(fileName ?? '__current__');
    try {
      const { fileName: resolvedName, content } = await diagnostics.downloadLogs(fileName);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = resolvedName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('settings.logs.downloadFailed'));
    } finally {
      setBusyFile(null);
    }
  }, [diagnostics, t]);

  const currentFilePath = logDirectory && logsInfo?.current
    ? `${logDirectory}${logDirectory.includes('\\') ? '\\' : '/'}${logsInfo.current}`
    : null;
  const sortedFiles = React.useMemo(
    () => [...(logsInfo?.files ?? [])].sort((a, b) => b.modifiedAt - a.modifiedAt),
    [logsInfo],
  );

  return (
    <SettingsPageLayout
      title={t('settings.page.logs.title')}
      description={t('settings.page.logs.description')}
      headerEnd={diagnostics ? (
        <Button
          variant="ghost"
          size="xs"
          className="!font-normal gap-1 text-muted-foreground"
          onClick={() => void loadLogsInfo()}
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </Button>
      ) : undefined}
      showSaveStatus={false}
    >
      <SettingsSection
        title={t('settings.logs.section.title')}
        divider={false}
        settingsItem="logs.file"
        titleAccessory={logDirectory ? (
          <SettingsInfoHint>{t('settings.logs.retainHint')}</SettingsInfoHint>
        ) : null}
      >
        {isLoadFailed && !logsInfo && (
          <p className="typography-meta text-muted-foreground">{t('settings.logs.unavailable')}</p>
        )}

        {logDirectory && (
          <SettingsFieldRow label={t('settings.logs.path')}>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
              <span className="min-w-0 flex-1 truncate text-right font-mono typography-micro text-muted-foreground" title={logDirectory}>
                {logDirectory}
              </span>
              <Button
                variant="ghost"
                size="xs"
                className="!font-normal gap-1 text-muted-foreground"
                onClick={() => void handleCopyPath()}
              >
                <Icon name="clipboard" className="h-3.5 w-3.5" />
                {t('settings.logs.copyPath')}
              </Button>
              {canRevealFolder && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="!font-normal gap-1 text-muted-foreground"
                  onClick={() => void handleRevealFolder(logDirectory)}
                >
                  <Icon name="folder-open" className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </SettingsFieldRow>
        )}

        {logsInfo && sortedFiles.length === 0 && (
          <p className="typography-meta text-muted-foreground">{t('settings.logs.empty')}</p>
        )}

        {sortedFiles.map((file) => (
          <LogFileRow
            key={file.name}
            file={file}
            isCurrent={file.name === logsInfo?.current}
            logDirectory={logDirectory}
            canOpenWithDefaultProgram={canOpenWithDefaultProgram}
            canRevealFolder={canRevealFolder}
            isBusy={busyFile === file.name || (busyFile === '__current__' && file.name === logsInfo?.current)}
            onOpen={() => void handleOpenWithDefaultProgram(joinPathSafe(logDirectory, file.name))}
            onReveal={() => void handleRevealFolder(joinPathSafe(logDirectory, file.name))}
            onDownload={() => void handleDownload(file.name)}
          />
        ))}
      </SettingsSection>
    </SettingsPageLayout>
  );
};

const joinPathSafe = (directory: string | null, fileName: string): string => {
  if (!directory) return fileName;
  return `${directory}${directory.includes('\\') ? '\\' : '/'}${fileName}`;
};

interface LogFileRowProps {
  file: LogFileInfo;
  isCurrent: boolean;
  logDirectory: string | null;
  canOpenWithDefaultProgram: boolean;
  canRevealFolder: boolean;
  isBusy: boolean;
  onOpen: () => void;
  onReveal: () => void;
  onDownload: () => void;
}

const LogFileRow: React.FC<LogFileRowProps> = ({
  file,
  isCurrent,
  logDirectory,
  canOpenWithDefaultProgram,
  canRevealFolder,
  isBusy,
  onOpen,
  onReveal,
  onDownload,
}) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex items-center gap-2">
          <span className={cn('truncate font-mono typography-meta', isCurrent ? 'text-foreground' : 'text-muted-foreground')}>
            {file.name}
          </span>
          {isCurrent && (
            <span className="typography-micro shrink-0 text-muted-foreground">({t('settings.logs.currentFile')})</span>
          )}
        </div>
        <div className="typography-micro text-muted-foreground/70">
          {formatBytes(file.size)} · {formatModifiedAt(file.modifiedAt)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canOpenWithDefaultProgram && (
          <Button
            variant="outline"
            size="xs"
            className="!font-normal gap-1"
            onClick={onOpen}
            disabled={isBusy || !logDirectory}
          >
            <Icon name="external-link" className="h-3.5 w-3.5" />
            {t('settings.logs.openWithDefault')}
          </Button>
        )}
        {canRevealFolder && (
          <Button
            variant="ghost"
            size="xs"
            className="!font-normal text-muted-foreground"
            onClick={onReveal}
            disabled={!logDirectory}
            aria-label={t('settings.logs.openFolder')}
          >
            <Icon name="folder-open" className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          className="!font-normal gap-1 text-muted-foreground"
          onClick={onDownload}
          disabled={isBusy}
          aria-label={t('settings.logs.downloadFileAria', { name: file.name })}
        >
          <Icon name="download" className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};
