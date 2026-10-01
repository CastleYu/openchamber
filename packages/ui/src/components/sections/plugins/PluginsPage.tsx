import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsBackButton } from '@/components/sections/shared/SettingsCards';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AddPluginDialog } from './AddPluginDialog';
import { PluginsGrid, type PluginDeleteTarget } from './PluginsGrid';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { RegistryBanner } from './RegistryBanner';
import { PluginStatusBanner } from './PluginStatusBanner';
import { configEntryRuntimeTarget, pluginFileRuntimeTarget } from './pluginLoadState';
import { opencodeClient } from '@/lib/opencode/client';
import { useProjectsStore } from '@/stores/useProjectsStore';
import {
  getPluginsConfigDirectory,
  getPluginsScopeKey,
  usePluginsStore,
  type PluginDraft,
  type PluginEntry,
  type PluginFile,
  type PluginScope,
} from '@/stores/usePluginsStore';

interface OptionsParseResult {
  ok: boolean;
  value?: Record<string, unknown>;
}

function parseOptionsJson(raw: string): OptionsParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

function stringifyOptions(options: Record<string, unknown> | undefined): string {
  if (!options || Object.keys(options).length === 0) {
    return '';
  }
  return JSON.stringify(options, null, 2);
}

function buildEntryDraft(entry: PluginEntry): PluginDraft {
  return {
    mode: 'entry',
    scope: entry.scope,
    spec: entry.spec,
    optionsJson: stringifyOptions(entry.options),
    fileName: '',
    content: '',
  };
}

function buildFileDraft(file: PluginFile, content: string): PluginDraft {
  return {
    mode: 'file',
    scope: file.scope,
    spec: '',
    optionsJson: '',
    fileName: file.fileName,
    content,
  };
}

const ScopeBadge: React.FC<{ scope: PluginScope; label: string }> = ({ scope, label }) => {
  return (
    <span
      className={cn(
        'typography-micro font-medium rounded-full px-2 py-0.5',
        'bg-[var(--surface-elevated)] text-muted-foreground',
        'border border-[var(--interactive-border)]',
      )}
      data-scope={scope}
    >
      {label}
    </span>
  );
};

export const PluginsPage: React.FC = () => {
  const { t } = useI18n();
  useProjectsStore((state) => state.getActiveProject()?.path);
  const scope = React.useSyncExternalStore(
    (listener) => opencodeClient.subscribeRuntime(listener),
    () => getPluginsScopeKey(getPluginsConfigDirectory()),
  );
  const isV2 = opencodeClient.getBoundRuntime()?.generation === 'oc2';
  const catalogIsCurrent = usePluginsStore((s) => s.loadedScope === scope);

  const selectedId = usePluginsStore((s) => s.selectedId);
  const entries = usePluginsStore((s) => s.entries);
  const files = usePluginsStore((s) => s.files);
  const draft = usePluginsStore((s) => s.draft);
  const setDraft = usePluginsStore((s) => s.setDraft);
  const updateEntry = usePluginsStore((s) => s.updateEntry);
  const updateFile = usePluginsStore((s) => s.updateFile);
  const readFile = usePluginsStore((s) => s.readFile);
  const setSelected = usePluginsStore((s) => s.setSelected);
  const deleteEntry = usePluginsStore((s) => s.deleteEntry);
  const deleteFile = usePluginsStore((s) => s.deleteFile);
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<PluginDeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  React.useEffect(() => {
    const handleOpenAdd = () => setIsAddOpen(true);
    window.addEventListener('openchamber:settings-open-plugin-add', handleOpenAdd);
    return () => window.removeEventListener('openchamber:settings-open-plugin-add', handleOpenAdd);
  }, []);

  React.useEffect(() => () => {
    usePluginsStore.getState().setSelected(null);
  }, []);

  const selectedEntry = React.useMemo(
    () => (catalogIsCurrent && selectedId ? entries.find((e) => e.id === selectedId) ?? null : null),
    [catalogIsCurrent, entries, selectedId],
  );
  const selectedFile = React.useMemo(
    () => (catalogIsCurrent && selectedId ? files.find((f) => f.id === selectedId && f.kind === 'file') ?? null : null),
    [catalogIsCurrent, files, selectedId],
  );
  const selectedEntryTarget = React.useMemo(
    () => selectedEntry ? configEntryRuntimeTarget(selectedEntry.spec, selectedEntry.sourcePath) : null,
    [selectedEntry],
  );
  const selectedFileTarget = React.useMemo(
    () => selectedFile ? pluginFileRuntimeTarget(selectedFile.absolutePath) : null,
    [selectedFile],
  );

  const [isSaving, setIsSaving] = React.useState(false);
  const [isLoadingFile, setIsLoadingFile] = React.useState(false);
  const originalFileContentById = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    let cancelled = false;

    if (selectedEntry) {
      setDraft(buildEntryDraft(selectedEntry));
      return () => {
        cancelled = true;
      };
    }

    if (selectedFile) {
      setIsLoadingFile(true);
      void (async () => {
        const result = await readFile(selectedFile.id);
        if (cancelled) return;
        setIsLoadingFile(false);
        const content = result?.content ?? '';
        originalFileContentById.current.set(selectedFile.id, content);
        setDraft(buildFileDraft(selectedFile, content));
      })();
      return () => {
        cancelled = true;
      };
    }

    setDraft(null);
    return () => {
      cancelled = true;
    };
  }, [selectedEntry, selectedFile, readFile, setDraft]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const result = deleteTarget.kind === 'entry' ? await deleteEntry(deleteTarget.id) : await deleteFile(deleteTarget.id);
    if (result.ok) {
      toast.success(result.message || t('settings.plugins.sidebar.toast.deleted', { name: deleteTarget.label }));
    } else {
      toast.error(t('settings.plugins.sidebar.toast.deleteFailed'));
    }
    setDeleteTarget(null);
    setIsDeleting(false);
  };

  const dialogs = (
    <>
      <AddPluginDialog open={isAddOpen} onOpenChange={setIsAddOpen} />
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('settings.plugins.sidebar.deleteDialog.title')}</DialogTitle>
            <DialogDescription>{t('settings.plugins.sidebar.deleteDialog.description', { name: deleteTarget?.label ?? '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              {t('settings.common.actions.cancel')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void handleDelete()} disabled={isDeleting}>
              {isDeleting ? t('settings.plugins.sidebar.actions.deleting') : t('settings.common.actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (!selectedId) {
    return (
      <>
        <PluginsGrid onAdd={() => setIsAddOpen(true)} onDelete={setDeleteTarget} />
        {dialogs}
      </>
    );
  }

  const backButton = <SettingsBackButton label={t('settings.plugins.page.back')} onClick={() => setSelected(null)} />;
  const deleteButton = (
    <Button variant="ghost" size="xs" className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]" onClick={() => {
      if (selectedEntry) setDeleteTarget({ kind: 'entry', id: selectedEntry.id, label: selectedEntry.spec });
      else if (selectedFile) setDeleteTarget({ kind: 'file', id: selectedFile.id, label: selectedFile.fileName });
    }}>
      <Icon name="delete-bin" className="size-3.5" />
      {t('settings.common.actions.delete')}
    </Button>
  );

  if (selectedEntry && draft && draft.mode === 'entry') {
    const optionsResult = parseOptionsJson(draft.optionsJson);
    const optionsValid = optionsResult.ok;
    const isDirty =
      draft.spec !== selectedEntry.spec ||
      draft.optionsJson !== stringifyOptions(selectedEntry.options);

    const handleEntryDiscard = () => {
      setDraft(buildEntryDraft(selectedEntry));
    };

    const handleEntrySave = async () => {
      if (!optionsValid) return;
      const spec = draft.spec.trim();
      if (!spec) {
        toast.error(t('settings.plugins.validation.specRequired'));
        return;
      }

      setIsSaving(true);
      try {
        const result = await updateEntry(selectedEntry.id, {
          spec,
          options: optionsResult.value,
        });
        if (result.ok) {
          if (result.reloadFailed) {
            toast.warning(
              result.message || t('settings.plugins.toast.reloadFailed'),
              { description: result.warning },
            );
          } else if (result.restartDeferred) {
            toast.success(t('settings.view.pendingRestart.saved'));
          } else {
            toast.success(result.message || t('settings.plugins.toast.updated'));
          }
        } else {
          toast.error(result.message || t('settings.plugins.toast.reloadFailed'));
        }
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <>
      <SettingsPageLayout
        title={t('settings.plugins.page.header.entry')}
        titleLeading={backButton}
        headerEnd={deleteButton}
        titleAccessory={(
          <ScopeBadge
            scope={selectedEntry.scope}
            label={
              selectedEntry.scope === 'project'
                ? t('settings.plugins.sidebar.group.projectEntries')
                : t('settings.plugins.sidebar.group.userEntries')
            }
          />
        )}
        showSaveStatus={false}
      >
        <SettingsSection divider={false}>
          {isV2 ? <PluginStatusBanner target={selectedEntryTarget} name={selectedEntry.spec} /> : null}
          <RegistryBanner entryId={selectedEntry.id} spec={selectedEntry.spec} />
        </SettingsSection>

        <SettingsSection
          title={t('settings.plugins.page.field.spec')}
          settingsItem="plugins.spec"
        >
          <Input
            value={draft.spec}
            onChange={(e) =>
              setDraft({ ...draft, spec: e.target.value })
            }
            placeholder={t('settings.plugins.page.field.spec.placeholder')}
            className="font-mono typography-meta"
            spellCheck={false}
          />
        </SettingsSection>

        <SettingsSection
          title={t('settings.plugins.page.field.options')}
          settingsItem="plugins.options"
        >
          <Textarea
            value={draft.optionsJson}
            onChange={(e) =>
              setDraft({ ...draft, optionsJson: e.target.value })
            }
            rows={10}
            className={cn(
              'font-mono typography-meta min-h-[200px]',
              !optionsValid && 'border-[var(--status-error-border)]',
            )}
            spellCheck={false}
            placeholder='{ }'
          />
          {!optionsValid && (
            <p className="typography-micro text-[var(--status-error)]">
              {t('settings.plugins.page.field.options.invalidJson')}
            </p>
          )}
          <div className="flex items-center gap-2 pt-3">
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleEntrySave()}
              disabled={!isDirty || !optionsValid || isSaving}
            >
              {t('settings.plugins.page.action.save')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEntryDiscard}
              disabled={!isDirty || isSaving}
            >
              {t('settings.plugins.page.action.discard')}
            </Button>
          </div>
        </SettingsSection>
      </SettingsPageLayout>
      {dialogs}
      </>
    );
  }

  if (selectedFile && draft && draft.mode === 'file') {
    const originalContent = originalFileContentById.current.get(selectedFile.id) ?? '';
    const isDirty = draft.content !== originalContent || draft.fileName !== selectedFile.fileName;

    const handleFileDiscard = () => {
      void (async () => {
        setIsLoadingFile(true);
        const result = await readFile(selectedFile.id);
        const content = result?.content ?? '';
        setIsLoadingFile(false);
        originalFileContentById.current.set(selectedFile.id, content);
        setDraft(buildFileDraft(selectedFile, content));
      })();
    };

    const handleFileSave = async () => {
      setIsSaving(true);
      try {
        const result = await updateFile(selectedFile.id, { content: draft.content });
        if (result.ok) {
          originalFileContentById.current.set(selectedFile.id, draft.content);
          if (result.reloadFailed) {
            toast.warning(
              result.message || t('settings.plugins.toast.reloadFailed'),
              { description: result.warning },
            );
          } else if (result.restartDeferred) {
            toast.success(t('settings.view.pendingRestart.saved'));
          } else {
            toast.success(result.message || t('settings.plugins.toast.updated'));
          }
        } else {
          toast.error(result.message || t('settings.plugins.toast.reloadFailed'));
        }
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <>
      <SettingsPageLayout
        title={t('settings.plugins.page.header.file')}
        titleLeading={backButton}
        headerEnd={deleteButton}
        titleAccessory={(
          <>
            <ScopeBadge
              scope={selectedFile.scope}
              label={
                selectedFile.scope === 'project'
                  ? t('settings.plugins.sidebar.group.projectFiles')
                  : t('settings.plugins.sidebar.group.userFiles')
              }
            />
            <span
              className={cn(
                'typography-micro font-mono rounded-full px-2 py-0.5',
                'bg-[var(--surface-elevated)] text-foreground',
                'border border-[var(--interactive-border)]',
              )}
            >
              {selectedFile.fileName}
            </span>
          </>
        )}
        showSaveStatus={false}
      >
        {isV2 ? <SettingsSection divider={false}><PluginStatusBanner target={selectedFileTarget} name={selectedFile.fileName} /></SettingsSection> : null}
        <SettingsSection
          title={t('settings.plugins.page.field.content')}
          divider={false}
          settingsItem="plugins.content"
        >
          <Textarea
            value={draft.content}
            onChange={(e) =>
              setDraft({ ...draft, content: e.target.value })
            }
            rows={16}
            className="font-mono typography-meta min-h-[320px]"
            spellCheck={false}
            disabled={isLoadingFile}
          />
          <div className="flex items-center gap-2 pt-3">
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleFileSave()}
              disabled={!isDirty || isSaving || isLoadingFile}
            >
              {t('settings.plugins.page.action.save')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleFileDiscard}
              disabled={isSaving || isLoadingFile}
            >
              {t('settings.plugins.page.action.discard')}
            </Button>
          </div>
        </SettingsSection>
      </SettingsPageLayout>
      {dialogs}
      </>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center text-muted-foreground">
        <Icon name="loader-4" className="mx-auto mb-3 h-6 w-6 animate-spin opacity-50" />
      </div>
    </div>
  );
};
