import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { createAgentChatBinding, type AgentChatBinding } from '@/lib/agent/chatBinding';
import type { AgentClientSnapshot } from '@/lib/agent/client';
import { AGENT_FEATURE, AGENT_OPERATION, AGENT_PART, AGENT_ROLE } from '../../../web/server/lib/agent/constants.js';
import type { AgentMessage, AgentOperation, AgentPart, AgentStatus } from '../../../web/server/lib/agent/dispatcher.js';
import type { AgentFeature } from '../../../web/server/lib/agent/features.js';

const STATUS_KEYS = {
  idle: 'agent.chat.idle', busy: 'agent.chat.busy', waiting: 'agent.chat.waiting', unknown: 'agent.chat.unknownStatus',
} satisfies Readonly<{ [State in AgentStatus['state']]: I18nKey }>;
type BindingState = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; value: AgentChatBinding };
const ROLE_KEYS = {
  [AGENT_ROLE.USER]: 'agent.chat.user', [AGENT_ROLE.ASSISTANT]: 'agent.chat.assistant',
  [AGENT_ROLE.SYSTEM]: 'agent.chat.system', [AGENT_ROLE.SYNTHETIC]: 'agent.chat.synthetic',
} satisfies Readonly<{ [Role in AgentMessage['role']]: I18nKey }>;
const available = (snapshot: AgentClientSnapshot, operation: AgentOperation, feature: AgentFeature): boolean =>
  snapshot.runtime.operations[operation].available && snapshot.availability.features[feature].available;

function MessagePart({ part }: { part: AgentPart }) {
  const { t } = useI18n();
  switch (part.type) {
    case AGENT_PART.TEXT: return <p className="whitespace-pre-wrap break-words">{part.text}</p>;
    case AGENT_PART.REASONING: return <details><summary>{t('agent.chat.reasoning')}</summary><p className="whitespace-pre-wrap break-words">{part.text}</p></details>;
    case AGENT_PART.TOOL: return <details><summary>{t('agent.chat.tool', { name: part.name })}</summary><pre className="overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(part.state, null, 2)}</pre></details>;
    case AGENT_PART.ATTACHMENT: return <p>{t('agent.chat.attachment', { name: part.filename ?? part.assetID })}</p>;
  }
}

function ConversationView({ binding }: { binding: AgentChatBinding }) {
  const { t } = useI18n();
  const state = React.useSyncExternalStore(binding.conversation.subscribe, binding.conversation.getSnapshot);
  const [workspace, setWorkspace] = React.useState('');
  const [session, setSession] = React.useState('');
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const lock = React.useRef(false);
  const ids = React.useId();
  const canOpen = available(binding.snapshot, AGENT_OPERATION.GET_SESSION, AGENT_FEATURE.ACQUIRE_SESSION);
  const canHistory = available(binding.snapshot, AGENT_OPERATION.LIST_MESSAGES, AGENT_FEATURE.HISTORY);
  const canStatus = available(binding.snapshot, AGENT_OPERATION.GET_SESSION_STATUS, AGENT_FEATURE.PROMPT);
  const canPrompt = canStatus && available(binding.snapshot, AGENT_OPERATION.SEND_PROMPT, AGENT_FEATURE.PROMPT);
  const uncertain = state.state === 'bound' && state.write.state === 'unknown';
  const sending = state.state === 'bound' && state.write.state === 'sending';

  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try { await work(); } catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  const refresh = async () => {
    const results = await Promise.allSettled([
      ...(canHistory ? [binding.conversation.history()] : []),
      ...(canStatus ? [binding.conversation.status()] : []),
    ]);
    if (results.some((result) => result.status === 'rejected')) setFailed(true);
  };
  const open = async () => {
    await binding.conversation.open(binding.snapshot, workspace, session);
    setDraft('');
    await refresh();
  };
  const send = async () => {
    const before = binding.conversation.getSnapshot();
    if (before.state !== 'bound') return;
    const status = await binding.conversation.status();
    const current = binding.conversation.getSnapshot();
    if (status.state !== 'idle' || current.state !== 'bound' || current.session.id !== before.session.id
      || current.workspaceID !== before.workspaceID) return;
    const text = draft;
    const receipt = await binding.conversation.send(crypto.randomUUID(), text);
    if (receipt.state !== 'unknown') setDraft((latest) => latest === text ? '' : latest);
  };

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground">
      <section className="mx-auto max-w-3xl space-y-5">
        <h1 className="typography-ui-header">{t('agent.bootstrap.cagent')}</h1>
        {!canOpen ? <p role="status">{t('agent.bootstrap.closed')}</p> : null}
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(open); }}>
          <div className="space-y-2"><label htmlFor={`${ids}-workspace`}>{t('agent.chat.workspace')}</label>
            <Input id={`${ids}-workspace`} value={workspace} disabled={busy || !canOpen} onChange={(event) => setWorkspace(event.target.value)} /></div>
          <div className="space-y-2"><label htmlFor={`${ids}-session`}>{t('agent.chat.session')}</label>
            <Input id={`${ids}-session`} value={session} disabled={busy || !canOpen} onChange={(event) => setSession(event.target.value)} /></div>
          <Button type="submit" disabled={busy || !canOpen || !workspace || !session}>{t('agent.chat.open')}</Button>
        </form>
        {failed ? <p role="alert" className="text-destructive">{t('agent.chat.failed')}</p> : null}
        {state.state === 'bound' ? <>
          <div className="flex flex-wrap items-center gap-3">
            <p role="status">{t('agent.chat.status', { state: t(state.status.state === 'ready' ? STATUS_KEYS[state.status.value.state] : 'agent.chat.unknownStatus') })}</p>
            <Button variant="outline" disabled={busy || (!canHistory && !canStatus)} onClick={() => { void run(refresh); }}>{t('agent.chat.refresh')}</Button>
          </div>
          {uncertain ? <section className="space-y-3 rounded-lg border border-border p-4">
            <p role="alert">{t('agent.chat.unknown')}</p>
            <Button variant="outline" disabled={busy} onClick={() => { void run(() => binding.conversation.resolve()); }}>{t('agent.chat.resolve')}</Button>
          </section> : null}
          {state.write.state === 'accepted' || state.write.state === 'complete' ? <p role="status">{t('agent.chat.accepted')}</p> : null}
          {state.history.state === 'failed' ? <p role="alert">{t('agent.chat.failed')}</p> : null}
          {!canHistory ? <p>{t('agent.chat.unavailable')}</p> : null}
          <div role="log" className="space-y-3">
            {state.history.items.map((message) => <article key={message.id} data-role={message.role} className="space-y-2 rounded-lg border border-border bg-card p-4">
              <p className="text-muted-foreground">{t(ROLE_KEYS[message.role])}</p>
              {message.parts.map((part) => <MessagePart key={part.id} part={part} />)}
              {message.error ? <p role="alert">{message.error.message}</p> : null}
            </article>)}
          </div>
          {state.history.next ? <Button variant="outline" disabled={busy} onClick={() => { void run(() => binding.conversation.history(true)); }}>{t('agent.chat.more')}</Button> : null}
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(send); }}>
            <label htmlFor={`${ids}-prompt`}>{t('agent.chat.prompt')}</label>
            <Textarea id={`${ids}-prompt`} value={draft} disabled={busy || !canPrompt || uncertain || sending} onChange={(event) => setDraft(event.target.value)} />
            <Button type="submit" disabled={busy || !canPrompt || uncertain || sending || !draft.trim()}>{t('agent.chat.send')}</Button>
            {!canPrompt ? <p>{t('agent.chat.unavailable')}</p> : null}
          </form>
        </> : null}
      </section>
    </main>
  );
}

export default function CAgentApp({ create = createAgentChatBinding }: { create?: () => Promise<AgentChatBinding> }) {
  const { t } = useI18n();
  const [state, setState] = React.useState<BindingState>({ state: 'loading' });
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    let owned: AgentChatBinding | undefined;
    setState({ state: 'loading' });
    void create().then((binding) => {
      if (!live) { binding.dispose(); return; }
      owned = binding;
      setState({ state: 'ready', value: binding });
    }).catch(() => { if (live) setState({ state: 'failed' }); });
    return () => { live = false; owned?.dispose(); };
  }, [create, revision]);
  if (state.state === 'ready') return <ConversationView binding={state.value} />;
  return <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
    <section className="space-y-4">
      <p role={state.state === 'failed' ? 'alert' : 'status'}>{t(state.state === 'failed' ? 'agent.chat.failed' : 'common.loading')}</p>
      {state.state === 'failed' ? <Button onClick={() => setRevision((value) => value + 1)}>{t('agent.bootstrap.retry')}</Button> : null}
    </section>
  </main>;
}
