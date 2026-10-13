import React from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { opencodeClient } from '@/lib/opencode/client';
import type { AcpPermission } from '@/lib/opencode/operations';

export function AcpPermissionCard({ permission }: { permission: AcpPermission }) {
  const { t } = useI18n();
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const respond = async (optionID: string) => {
    setPending(true);
    setFailed(false);
    try { await opencodeClient.replyToAcpPermission(permission.id, optionID); }
    catch { setFailed(true); }
    finally { setPending(false); }
  };
  return <div className="chat-column pb-2"><div className="rounded-xl border border-border/30 bg-muted/10 p-3">
    <p className="typography-meta font-medium text-foreground">{permission.title}</p>
    <div className="mt-3 flex flex-wrap gap-2">{permission.options.map((option) =>
      <Button key={option.optionId} size="xs" variant={option.kind.startsWith('reject') ? 'outline' : 'default'} disabled={pending} onClick={() => void respond(option.optionId)}>{option.name}</Button>
    )}</div>
    {failed ? <p role="alert" className="mt-2 typography-micro text-destructive">{t('chat.formCard.tryAgain')}</p> : null}
  </div></div>;
}
