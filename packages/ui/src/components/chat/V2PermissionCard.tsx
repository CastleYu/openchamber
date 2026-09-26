import React from 'react';
import type { PermissionRequest } from '@opencode/client';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { respondToPermission } from '@/sync/session-actions';
import { permissionSummaryMetadataSchema, summarizePermission } from './permissionSummary';

/** OpenCode 2 permissions carry an action and resources, not OC1 patterns. */
export function V2PermissionCard({ permission }: { permission: PermissionRequest }) {
  const { t } = useI18n();
  const [responding, setResponding] = React.useState(false);
  const [resolved, setResolved] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const summary = summarizePermission(permission.action, permission.resources, permissionSummaryMetadataSchema.parse(permission.metadata), Boolean(permission.metadata));
  const alwaysLabel = permission.save?.length
    ? t('chat.permissionCard.alwaysAllowPatterns', { patterns: permission.save.join(', ') })
    : t('chat.permissionRequest.actions.always');

  const respond = async (decision: 'once' | 'always' | 'reject') => {
    setResponding(true);
    setFailed(false);
    try {
      await respondToPermission(permission.sessionID, permission.id, decision);
      setResolved(true);
    } catch {
      setFailed(true);
    } finally {
      setResponding(false);
    }
  };

  if (resolved) return null;
  return (
    <div className="chat-column pb-2">
      <div className="rounded-xl border border-border/30 bg-muted/10 p-3">
        <div className="flex items-center gap-2 typography-meta font-medium text-foreground">
          <Icon name="shield" className="size-4" />
          <span>{t(summary.titleKey, summary.tool ? { tool: summary.tool } : undefined)}</span>
        </div>
        {permission.message ? <p className="mt-2 typography-meta text-muted-foreground">{permission.message}</p> : null}
        {permission.resources.length ? (
          <ul className="mt-2 max-h-32 overflow-auto typography-meta text-muted-foreground">
            {permission.resources.map((resource) => <li key={resource} className="break-all">{resource}</li>)}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="xs" disabled={responding} onClick={() => void respond('once')}>{t('chat.permissionRequest.actions.once')}</Button>
          <Button size="xs" variant="outline" className="h-auto whitespace-normal break-all" disabled={responding} title={alwaysLabel} onClick={() => void respond('always')}>{alwaysLabel}</Button>
          <Button size="xs" variant="ghost" disabled={responding} onClick={() => void respond('reject')}>{t('chat.permissionRequest.actions.reject')}</Button>
        </div>
        {failed ? <p role="alert" className="mt-2 typography-micro text-[var(--status-error)]">{t('chat.formCard.tryAgain')}</p> : null}
      </div>
    </div>
  );
}
