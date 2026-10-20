import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/icon/Icon';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { openExternalUrl } from '@/lib/url';
import { recordDeferredOpenCodeRestart } from '@/lib/opencode/deferredRestart';
import { opencodeClient } from '@/lib/opencode/client';
import { supportsLegacyMethod } from './legacy-provider-ui';
import { beginLegacyProviderOAuth, disconnectLegacyProvider, LegacyProviderError, legacyProviderMethods, legacyProviderSources, saveLegacyProvider, type LegacyProviderDisconnect, type LegacyProviderMethods, type LegacyProviderOAuthFlow, type LegacyProviderSource, type LegacyProviderSources } from '@/lib/opencode/legacy-providers';
import { selectProvidersForDirectory, useConfigStore } from '@/stores/useConfigStore';
import { isConfigDefinedCustomProvider } from './custom-provider-form';

const isConfiguredLegacyCustomProvider = (provider: Parameters<typeof isConfigDefinedCustomProvider>[0], sources: LegacyProviderSources | undefined): boolean => {
  if (!sources) return false;
  return isConfigDefinedCustomProvider(provider, {
    user: { exists: sources.layers.some((layer) => layer.scope === 'user') },
    project: { exists: sources.layers.some((layer) => layer.scope === 'project') },
  });
};

const orderedLegacyProviderLayers = (sources: LegacyProviderSources): LegacyProviderSource[] =>
  [...sources.layers].sort((left, right) => left.order - right.order);

type Notice = 'saved' | 'partial' | 'disconnected' | 'unsupported' | 'methods' | 'save' | 'disconnect' | 'oauth' | 'openFailed';
const NOTICE_KEYS = {
  saved: 'settings.providers.legacy.notice.saved', partial: 'settings.providers.legacy.notice.partial',
  disconnected: 'settings.providers.legacy.notice.disconnected', unsupported: 'settings.providers.legacy.notice.unsupported',
  methods: 'settings.providers.legacy.notice.methods', save: 'settings.providers.legacy.notice.save',
  disconnect: 'settings.providers.legacy.notice.disconnect', oauth: 'settings.providers.legacy.notice.oauth',
  openFailed: 'settings.providers.legacy.notice.openFailed',
} satisfies Record<Notice, I18nKey>;
const SCOPE_KEYS = {
  user: 'settings.providers.legacy.scope.user', project: 'settings.providers.legacy.scope.project',
  inline: 'settings.providers.legacy.scope.inline', managed: 'settings.providers.legacy.scope.managed',
} satisfies Record<LegacyProviderSource['scope'], I18nKey>;
const ORIGIN_KEYS = {
  global: 'settings.providers.legacy.origin.global', 'explicit-config': 'settings.providers.legacy.origin.explicit-config',
  'project-root': 'settings.providers.legacy.origin.project-root', 'dot-directory': 'settings.providers.legacy.origin.dot-directory',
  'explicit-config-dir': 'settings.providers.legacy.origin.explicit-config-dir', inline: 'settings.providers.legacy.origin.inline',
  managed: 'settings.providers.legacy.origin.managed',
} satisfies Record<LegacyProviderSource['origin'], I18nKey>;
const CONFIGURATION_KEYS = {
  'matches-persisted': 'settings.providers.legacy.application.matches-persisted',
  'pending-restart': 'settings.providers.legacy.application.pending-restart', unknown: 'settings.providers.legacy.application.unknown',
} satisfies Record<LegacyProviderSources['application']['configuration'], I18nKey>;
const RESIDUAL_KEYS = {
  environment: 'settings.providers.legacy.residual.environment', 'remote-config': 'settings.providers.legacy.residual.remote-config',
  plugins: 'settings.providers.legacy.residual.plugins', 'effective-config': 'settings.providers.legacy.residual.effective-config',
} satisfies Record<LegacyProviderSources['residuals'][number], I18nKey>;

type LoadState = 'loading' | 'ready' | 'error';
type OAuthState = { providerId: string; method: number; attemptId: string; code: boolean } | null;
type OAuthSession = { flow: LegacyProviderOAuthFlow; controller: AbortController; providerId: string; scopeKey: string; abortFromLifetime: () => void };
type CredentialOutcome = LegacyProviderDisconnect['credential'];
const CREDENTIAL_KEYS = {
  unknown: 'settings.providers.legacy.credentialUnknown', absent: 'settings.providers.legacy.credentialAbsent',
  retained: 'settings.providers.legacy.credentialPresent', removed: 'settings.providers.legacy.credentialRemoved',
} satisfies Record<CredentialOutcome, I18nKey>;

export const LegacyProvidersPage: React.FC = () => {
  const { t } = useI18n();
  const directory = useSettingsDirectory();
  const configuredProviders = useConfigStore((state) => selectProvidersForDirectory(state, directory));
  const providers = React.useMemo(() => configuredProviders.filter((provider) => provider.generation === 'oc1'), [configuredProviders]);
  const runtime = React.useSyncExternalStore(
    (listener) => opencodeClient.subscribeRuntime(listener),
    () => opencodeClient.getBoundRuntime(),
    () => null,
  );
  const scopeKey = JSON.stringify([runtime?.endpoint, runtime?.epoch, runtime?.generation, runtime?.profile, runtime?.version, directory]);
  const lifetime = React.useMemo(() => ({ scopeKey, controller: new AbortController() }), [scopeKey]);
  const [methods, setMethods] = React.useState<LegacyProviderMethods | null>(null);
  const [methodsState, setMethodsState] = React.useState<LoadState>('loading');
  const [sources, setSources] = React.useState<Record<string, LegacyProviderSources>>({});
  const [sourceState, setSourceState] = React.useState<Record<string, LoadState>>({});
  const [keys, setKeys] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [oauth, setOAuth] = React.useState<OAuthState>(null);
  const [oauthCode, setOAuthCode] = React.useState('');
  const oauthFlow = React.useRef<OAuthSession | null>(null);
  const [credentialOutcomes, setCredentialOutcomes] = React.useState<Record<string, CredentialOutcome>>({});
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const validScope = React.useRef(scopeKey);
  validScope.current = scopeKey;

  React.useLayoutEffect(() => {
    if (lifetime.controller.signal.aborted) lifetime.controller = new AbortController();
    const controller = lifetime.controller;
    setSources({}); setSourceState({}); setKeys({}); setCredentialOutcomes({}); setNotice(null); setOAuth(null); setOAuthCode(''); setBusy(null);
    setMethods(null); setMethodsState('loading');
    return () => {
      controller.abort();
      const active = oauthFlow.current;
      oauthFlow.current = null;
      if (active) { active.controller.abort(); void active.flow.cancel().catch(() => undefined); }
    };
  }, [lifetime]);
  React.useEffect(() => {
    let active = true;
    setMethodsState('loading');
    setMethods(null);
    void legacyProviderMethods({ directory: directory ?? undefined, signal: lifetime.controller.signal }).then((result) => {
      if (active) { setMethods(result); setMethodsState('ready'); }
    }).catch((error) => {
      if (active && !lifetime.controller.signal.aborted) { setMethodsState('error'); setNotice(error instanceof LegacyProviderError && error.kind === 'unsupported' ? 'unsupported' : 'methods'); }
    });
    return () => { active = false; };
  }, [directory, lifetime]);

  const refreshSource = React.useCallback(async (providerId: string, signal = lifetime.controller.signal): Promise<LegacyProviderSources | null> => {
    setSourceState((current) => ({ ...current, [providerId]: 'loading' }));
    try {
      const result = await legacyProviderSources(providerId, { directory: directory ?? undefined, signal });
      if (signal.aborted || validScope.current !== scopeKey) return null;
      setSources((current) => ({ ...current, [providerId]: result }));
      setSourceState((current) => ({ ...current, [providerId]: 'ready' }));
      return result;
    } catch {
      if (!signal.aborted && validScope.current === scopeKey) setSourceState((current) => ({ ...current, [providerId]: 'error' }));
      return null;
    }
  }, [directory, lifetime, scopeKey]);

  const providerIds = React.useMemo(() => providers.map((provider) => provider.id), [providers]);
  React.useEffect(() => {
    for (const providerId of providerIds) void refreshSource(providerId);
  }, [providerIds, refreshSource]);

  const releaseOAuth = React.useCallback((session: OAuthSession, cancel: boolean) => {
    lifetime.controller.signal.removeEventListener('abort', session.abortFromLifetime);
    if (oauthFlow.current === session) oauthFlow.current = null;
    if (cancel) { session.controller.abort(); void session.flow.cancel().catch(() => undefined); }
  }, [lifetime]);

  const cancelOAuth = React.useCallback(() => {
    const active = oauthFlow.current;
    if (active) releaseOAuth(active, true);
    setOAuth(null); setOAuthCode('');
  }, [releaseOAuth]);

  const finishWrite = React.useCallback(async (providerId: string) => {
    recordDeferredOpenCodeRestart('providers', { id: providerId });
    await refreshSource(providerId);
    return validScope.current === scopeKey && !lifetime.controller.signal.aborted;
  }, [refreshSource, lifetime, scopeKey]);

  const saveKey = async (providerId: string) => {
    const key = keys[providerId] ?? '';
    setKeys((current) => ({ ...current, [providerId]: '' }));
    if (!key.trim()) return;
    setBusy(providerId); setNotice(null);
    try {
      await saveLegacyProvider(providerId, key, { directory: directory ?? undefined, signal: lifetime.controller.signal });
      if (validScope.current !== scopeKey || lifetime.controller.signal.aborted) return;
      if (await finishWrite(providerId)) setNotice('saved');
    } catch (error) {
      if (validScope.current !== scopeKey || lifetime.controller.signal.aborted) return;
      if (error instanceof LegacyProviderError && (error.outcome?.persisted || error.outcome?.partial || error.requiresRestart || error.credential === 'unknown' || error.outcome?.credential === 'unknown')) {
        await recordPartial(providerId, error);
      } else setNotice(error instanceof LegacyProviderError && error.kind === 'unsupported' ? 'unsupported' : 'save');
    } finally { if (validScope.current === scopeKey && !lifetime.controller.signal.aborted) setBusy(null); }
  };

  const disconnect = async (providerId: string) => {
    setBusy(providerId); setNotice(null);
    try {
      const outcome = await disconnectLegacyProvider(providerId, { directory: directory ?? undefined, signal: lifetime.controller.signal });
      if (validScope.current !== scopeKey || lifetime.controller.signal.aborted) return;
      if (await finishWrite(providerId)) {
        setCredentialOutcomes((current) => ({ ...current, [providerId]: outcome.credential }));
        setNotice(outcome.credential === 'unknown' ? 'partial' : 'disconnected');
      }
    } catch (error) {
      if (validScope.current !== scopeKey || lifetime.controller.signal.aborted) return;
      if (error instanceof LegacyProviderError && (error.outcome?.persisted || error.outcome?.partial || error.requiresRestart || error.credential === 'unknown' || error.outcome?.credential === 'unknown')) {
        await recordPartial(providerId, error);
      } else setNotice(error instanceof LegacyProviderError && error.kind === 'unsupported' ? 'unsupported' : 'disconnect');
    } finally { if (validScope.current === scopeKey && !lifetime.controller.signal.aborted) setBusy(null); }
  };

  const recordPartial = async (providerId: string, error: LegacyProviderError) => {
    recordDeferredOpenCodeRestart('providers', { id: providerId });
    const source = await refreshSource(providerId);
    if (validScope.current !== scopeKey || lifetime.controller.signal.aborted) return;
    const outcome = error.outcome?.credential ?? error.credential;
    const credential = outcome ?? (source?.complete ? source.auth.exists ? 'retained' : 'absent' : 'unknown');
    setCredentialOutcomes((current) => ({ ...current, [providerId]: credential }));
    setNotice('partial');
  };

  const authorize = async (providerId: string, methodIndex: number) => {
    if (oauthFlow.current) releaseOAuth(oauthFlow.current, true);
    setBusy(providerId); setNotice(null); setOAuthCode('');
    const controller = new AbortController();
    const abortFromLifetime = () => controller.abort();
    lifetime.controller.signal.addEventListener('abort', abortFromLifetime, { once: true });
    let session: OAuthSession | null = null;
    let keepSession = false;
    try {
      const flow = await beginLegacyProviderOAuth(providerId, methodIndex, { directory: directory ?? undefined, signal: controller.signal });
      session = { flow, controller, providerId, scopeKey, abortFromLifetime };
      oauthFlow.current = session;
      const authorization = await flow.authorize(controller.signal);
      if (controller.signal.aborted || validScope.current !== scopeKey) { releaseOAuth(session, true); return; }
      const opened = await openExternalUrl(authorization.url);
      if (controller.signal.aborted || validScope.current !== scopeKey) { releaseOAuth(session, true); return; }
      if (!opened) { releaseOAuth(session, true); setNotice('openFailed'); return; }
      if (authorization.method === 'code') {
        keepSession = true;
        setOAuth({ providerId, method: methodIndex, attemptId: flow.attemptId, code: true });
        return;
      }
      await flow.callback(undefined, controller.signal);
      releaseOAuth(session, false);
      if (controller.signal.aborted || validScope.current !== scopeKey) return;
      if (await finishWrite(providerId)) setNotice('saved');
    } catch (error) {
      const canceled = controller.signal.aborted || validScope.current !== scopeKey;
      if (session) releaseOAuth(session, true);
      if (canceled) return;
      if (error instanceof LegacyProviderError && (error.outcome?.partial || error.outcome?.persisted || error.requiresRestart || error.credential === 'unknown' || error.outcome?.credential === 'unknown')) await recordPartial(providerId, error);
      else setNotice(error instanceof LegacyProviderError && error.kind === 'unsupported' ? 'unsupported' : 'oauth');
    } finally {
      if (!keepSession) lifetime.controller.signal.removeEventListener('abort', abortFromLifetime);
      if (validScope.current === scopeKey && !lifetime.controller.signal.aborted) setBusy(null);
    }
  };

  const submitOAuthCode = async () => {
    if (!oauth) return;
    const activeOAuth = oauth;
    const active = oauthFlow.current;
    const code = oauthCode;
    setOAuthCode(''); setBusy(activeOAuth.providerId);
    try {
      if (!active || active.flow.attemptId !== activeOAuth.attemptId || active.scopeKey !== scopeKey) throw new LegacyProviderError('stale', 409);
      await active.flow.callback(code, active.controller.signal);
      releaseOAuth(active, false);
      if (active.controller.signal.aborted || validScope.current !== scopeKey) return;
      setOAuth(null); if (await finishWrite(activeOAuth.providerId)) setNotice('saved');
    } catch (error) {
      const canceled = active?.controller.signal.aborted || lifetime.controller.signal.aborted || validScope.current !== scopeKey;
      if (active) releaseOAuth(active, true);
      if (canceled) return;
      setOAuth(null);
      if (error instanceof LegacyProviderError && (error.outcome?.partial || error.outcome?.persisted || error.requiresRestart || error.credential === 'unknown' || error.outcome?.credential === 'unknown')) await recordPartial(activeOAuth.providerId, error);
      else setNotice(error instanceof LegacyProviderError && error.kind === 'unsupported' ? 'unsupported' : 'oauth');
    } finally { if (validScope.current === scopeKey && !lifetime.controller.signal.aborted) setBusy(null); }
  };

  const message = notice ? t(NOTICE_KEYS[notice]) : null;
  return <SettingsPageLayout title={t('settings.providers.legacy.title')} description={t('settings.providers.legacy.description')}>
    <SettingsSection title={t('settings.providers.legacy.section')} info={t('settings.providers.legacy.layers.help')} divider={false}>
      {methodsState === 'loading' ? <p className="typography-ui-label text-muted-foreground">{t('settings.providers.legacy.loading')}</p> : null}
      {methodsState === 'error' ? <p role="alert" className="typography-ui-label text-destructive">{t('settings.providers.legacy.methodsError')}</p> : null}
      {message ? <p role={notice === 'save' || notice === 'oauth' || notice === 'disconnect' || notice === 'unsupported' ? 'alert' : 'status'} className="typography-ui-label text-muted-foreground">{message}</p> : null}
      {providers.map((provider) => {
        const source = sources[provider.id];
        const providerMethods = methods?.[provider.id] ?? [];
        const hasAuth = Boolean(source?.auth.exists);
        const credentialStatus = credentialOutcomes[provider.id] ?? (sourceState[provider.id] === 'error' || !source || !source.complete ? 'unknown' : hasAuth ? 'retained' : 'absent');
        const customProvider = isConfiguredLegacyCustomProvider(provider, source);
        const canWrite = sourceState[provider.id] === 'ready' && source?.complete && credentialOutcomes[provider.id] !== 'unknown' && busy === null;
        const canDisconnect = hasAuth || Boolean(source?.layers.length);
        return <article key={provider.id} className="my-6 space-y-3">
          <header className="flex items-center gap-3"><ProviderLogo providerId={provider.id} className="h-8 w-8" /><div className="min-w-0"><h2 className="typography-ui-label font-medium">{provider.name || provider.id}</h2><p className="typography-meta text-muted-foreground">{provider.id}</p></div></header>
          {sourceState[provider.id] === 'loading' ? <p className="mt-3 typography-meta text-muted-foreground">{t('settings.providers.legacy.loadingSources')}</p> : null}
          {sourceState[provider.id] === 'error' ? <p role="alert" className="mt-3 typography-meta text-destructive">{t('settings.providers.legacy.sourcesError')}</p> : null}
          {source ? <div className="mt-4 space-y-3">
            <p className="typography-meta">{source.complete ? t('settings.providers.legacy.complete') : t('settings.providers.legacy.partial')}</p>
            <div><h3 className="typography-meta font-medium">{t('settings.providers.legacy.layers.title')}</h3>
              {source.layers.length ? <ol className="mt-2 space-y-2">{orderedLegacyProviderLayers(source).map((layer) => <li key={String(layer.order) + ':' + (layer.path ?? 'none')} className="typography-meta">
                <span className="font-medium">{t(SCOPE_KEYS[layer.scope])} · {t(ORIGIN_KEYS[layer.origin])}</span>
                <span className="block break-all text-muted-foreground">{layer.path ?? t('settings.providers.legacy.noPath')}</span>
                <span className="text-muted-foreground">{t('settings.providers.legacy.layerOrder', { order: layer.order })} · {layer.writable ? t('settings.providers.legacy.writable') : t('settings.providers.legacy.readOnly')}</span>
              </li>)}</ol> : <p className="mt-2 typography-meta text-muted-foreground">{t('settings.providers.legacy.noLayers')}</p>}</div>
            <p className="typography-meta">{t('settings.providers.legacy.configuration')}: {t(CONFIGURATION_KEYS[source.application.configuration])}</p>
            {source.residuals.length > 0 ? <p className="typography-meta text-muted-foreground">{t('settings.providers.legacy.residuals')}: {source.residuals.map((item) => t(RESIDUAL_KEYS[item])).join(', ')}</p> : null}
            <p className="typography-meta text-muted-foreground">{t('settings.providers.legacy.credential')}: {t(CREDENTIAL_KEYS[credentialStatus])}</p>
          </div> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {customProvider ? null : providerMethods.map((method, index) => method.type === 'api' ? <React.Fragment key={method.type + ':' + index}>
              {method.prompts?.length ? <p className="w-full typography-meta text-muted-foreground">{t('settings.providers.legacy.promptsUnsupported')}</p> : <>
                <Input type="password" autoComplete="new-password" value={keys[provider.id] ?? ''} onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))} disabled={!canWrite} className="max-w-[24rem]" placeholder={t('settings.providers.legacy.apiKey')} aria-label={t('settings.providers.legacy.apiKey')} />
                <Button disabled={!canWrite || !(keys[provider.id] ?? '').trim()} onClick={() => void saveKey(provider.id)}>{t('settings.providers.legacy.save')}</Button>
              </>}
            </React.Fragment> : method.type === 'oauth' ? <Button key={method.type + ':' + index} variant="outline" disabled={!canWrite || !supportsLegacyMethod(method)} onClick={() => void authorize(provider.id, index)}>
              <Icon name="external-link" className="mr-2 h-4 w-4" />{method.prompts?.length ? t('settings.providers.legacy.promptsUnsupported') : method.label || t('settings.providers.legacy.signIn')}
            </Button> : null)}
            {canDisconnect ? <Button variant="outline" disabled={!canWrite} onClick={() => void disconnect(provider.id)}>{t('settings.providers.legacy.disconnect')}</Button> : null}
            {customProvider ? <p className="w-full typography-meta text-muted-foreground">{t('settings.providers.legacy.customClosed')}</p> : null}
          </div>
        </article>;
      })}
      <Dialog open={Boolean(oauth?.code)} onOpenChange={(open) => { if (!open) cancelOAuth(); }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t('settings.providers.legacy.codeTitle')}</DialogTitle><DialogDescription>{t('settings.providers.legacy.codeHelp')}</DialogDescription></DialogHeader><Input value={oauthCode} onChange={(event) => setOAuthCode(event.target.value)} aria-label={t('settings.providers.legacy.codeTitle')} autoComplete="one-time-code"/><DialogFooter><Button variant="outline" onClick={cancelOAuth}>{t('settings.providers.legacy.cancel')}</Button><Button disabled={!oauthCode.trim() || busy === oauth?.providerId} onClick={() => void submitOAuthCode()}>{t('settings.providers.legacy.continue')}</Button></DialogFooter></DialogContent>
      </Dialog>
    </SettingsSection>
  </SettingsPageLayout>;
};
