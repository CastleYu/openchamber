import React from 'react';
import type { IntegrationInfo } from '@opencode/client';
import { opencodeClient } from '@/lib/opencode/client';
import { ProviderOAuthMethods } from '@/components/sections/providers/ProviderOAuthMethodsV2';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { findMcpIntegration, getMcpOAuthMethods } from './mcpOAuthIntegration';

interface McpOAuthSignInProps {
  serverName: string;
  /** The Location whose config declares the server; its integration lives there. */
  directory: string | null;
  /** Runs after OpenCode has stored the credential, so the caller can reconnect. */
  onConnected: () => void | Promise<void>;
}

/**
 * The OAuth sign-in for a remote MCP server. OpenCode registers such a server
 * as an integration with one `oauth` method, so the sign-in is the same
 * connect / status / complete flow the Providers page runs; only the lookup
 * (by server name, in the server's Location) is MCP-specific. Renders nothing
 * while the integration is unknown.
 */
export const McpOAuthSignIn: React.FC<McpOAuthSignInProps> = ({ serverName, directory, onConnected }) => {
  const { t } = useI18n();
  const [integration, setIntegration] = React.useState<IntegrationInfo | null>(null);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setIntegration(null);
    setError(false);
    setLoading(true);
    const load = async () => {
      try {
        const [catalog, { data }] = await Promise.all([
          opencodeClient.getMcpCatalog(directory),
          opencodeClient.listIntegrations(directory),
        ]);
        if (cancelled) return;
        const integrationID = catalog.generation === 'oc2'
          ? catalog.value.find((server) => server.name === serverName)?.integrationID
          : undefined;
        const selected = (
          (integrationID ? data.find((entry) => entry.id === integrationID) : undefined)
          ?? findMcpIntegration(data, serverName)
        );
        if (!selected || getMcpOAuthMethods(selected).length === 0) {
          setError(true);
          return;
        }
        setIntegration(selected);
      } catch (error) {
        console.error('Failed to load MCP integrations:', error);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [directory, revision, serverName]);

  if (loading) return <p className="typography-meta text-muted-foreground">{t('settings.mcp.page.actions.starting')}</p>;
  if (error) return (
    <div className="space-y-2">
      <p className="typography-meta text-muted-foreground">{t('settings.mcp.page.toast.authorizationStartFailed')}</p>
      <Button variant="outline" size="xs" onClick={() => setRevision((value) => value + 1)}>
        {t('settings.agents.page.permissionsEditor.actions.retry')}
      </Button>
    </div>
  );
  const methods = getMcpOAuthMethods(integration ?? undefined);
  if (!integration || methods.length === 0) return null;

  return (
    <ProviderOAuthMethods
      key={integration.id}
      integrationId={integration.id}
      methods={methods}
      directory={directory}
      onConnected={onConnected}
      successToast={false}
    />
  );
};
