import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui';
import { useMcpStore } from '@/stores/useMcpStore';
import { McpOAuthSignIn } from './McpOAuthSignIn';

type Props = {
  name: string | null;
  directory: string | null;
  onClose(): void;
};

export const McpOAuthDialog: React.FC<Props> = ({ name, directory, onClose }) => {
  const { t } = useI18n();
  const connect = useMcpStore((state) => state.connect);
  const refresh = useMcpStore((state) => state.refresh);

  const connected = async () => {
    if (!name) return;
    try {
      await connect(name, directory);
      await refresh({ directory, silent: true });
      const status = useMcpStore.getState().getStatusForDirectory(directory)[name];
      if (status?.status !== 'connected') throw new Error(t('settings.mcp.page.toast.connectionTestFailed'));
      toast.success(t('settings.mcp.page.toast.authorizationCompleted'));
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.mcp.page.toast.connectionTestFailed'));
    }
  };

  return (
    <Dialog open={name !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.mcp.page.actions.authorize')}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {name && <McpOAuthSignIn serverName={name} directory={directory} onConnected={connected} />}
      </DialogContent>
    </Dialog>
  );
};
