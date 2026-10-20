import * as React from 'react';
import { AcpClient } from '@/lib/opencode/acp';
import type { AcpInfo, AcpConnectionInput, AcpAnswer } from '@/lib/opencode/acp-interactions';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

/** Settings can authenticate before the conversation runtime has been bound. */
export function useAcpAuthentication(enabled: boolean) {
  const runtime = React.useSyncExternalStore(subscribeRuntimeEndpointChanged, getRuntimeKey, getRuntimeKey);
  const [retry, setRetry] = React.useState(0);
  const [info, setInfo] = React.useState<AcpInfo | null>(null);
  const [inputs, setInputs] = React.useState<AcpConnectionInput[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<'idle' | 'authenticating' | 'authenticated'>('idle');
  const [connected, setConnected] = React.useState(false);
  const [client] = React.useState(() => new AcpClient());
  const owner = React.useRef(0);
  const authenticating = React.useRef(false);

  React.useEffect(() => {
    const revision = ++owner.current;
    authenticating.current = false;
    setInfo(null); setInputs([]); setError(null); setStatus('idle'); setConnected(false);
    if (!enabled) return;
    const abort = new AbortController();
    const current = () => !abort.signal.aborted && owner.current === revision && runtime === getRuntimeKey();
    void client.info(abort.signal).then((value) => { if (current()) setInfo(value); }).catch((cause: Error) => { if (current()) setError(cause.message); });
    void (async () => {
      for await (const event of client.interactionEvents(abort.signal)) {
        if (!current()) return;
        if (event.type === 'connection-inputs') { setInputs(event.inputs); setConnected(!event.error); if (event.error) { setError(event.error); setStatus('idle'); } }
      }
      if (current()) { setConnected(false); setError('ACP connection closed'); }
    })().catch((cause: Error) => { if (current()) { setConnected(false); setError(cause.message); } });
    return () => { owner.current = revision + 1; abort.abort(); };
  }, [client, enabled, retry, runtime]);

  const authenticate = async (methodId: string) => {
    if (!info || authenticating.current || !connected || runtime !== getRuntimeKey()) return;
    const revision = owner.current;
    authenticating.current = true;
    setError(null); setStatus('authenticating');
    try {
      await client.authenticate(methodId, info.epoch);
      if (revision === owner.current && runtime === getRuntimeKey()) setStatus('authenticated');
    } catch (cause) {
      if (revision === owner.current && runtime === getRuntimeKey()) { setStatus('idle'); setError(cause instanceof Error ? cause.message : String(cause)); }
    } finally { if (revision === owner.current) authenticating.current = false; }
  };
  const respond = async (id: string, answer: AcpAnswer) => {
    if (!connected || runtime !== getRuntimeKey()) throw new Error('ACP connection changed');
    return client.replyInput(id, answer);
  };
  return { info: enabled ? info : null, inputs: enabled ? inputs : [], error: enabled ? error : null, status, connected, authenticate, respond, reconnect: () => setRetry((value) => value + 1) };
}
