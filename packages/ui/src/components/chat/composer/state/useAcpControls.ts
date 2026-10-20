import * as React from 'react';
import { opencodeClient } from '@/lib/opencode/client';
import type { AcpControls } from '@/lib/opencode/acp';
import type { Session } from '@/lib/opencode/model';

/** Controls belong to one selected session and runtime, never the global catalog. */
export function useAcpControls(session: Session | null | undefined) {
    const runtime = React.useSyncExternalStore(
        (listener) => opencodeClient.subscribeRuntime(listener),
        () => opencodeClient.getBoundRuntime(),
        () => null,
    );
    const [state, setState] = React.useState<{
        session: string; runtime: typeof runtime; controls?: AcpControls; error?: string; changing: boolean;
    }>({ session: '', runtime: null, changing: false });
    const owner = React.useRef({ session: session?.id, runtime });
    owner.current = { session: session?.id, runtime };
    const revision = React.useRef(0);
    const pending = React.useRef(false);

    React.useEffect(() => {
        if (runtime?.generation !== 'acp' || !session) return;
        const request = ++revision.current;
        const abort = new AbortController();
        const id = session.id;
        void opencodeClient.getAcpControls(id, abort.signal).then((controls) => {
            if (request === revision.current && owner.current.session === id && owner.current.runtime === runtime) {
                setState({ session: id, runtime, controls, changing: false });
            }
        }).catch((error: Error) => {
            if (!abort.signal.aborted && request === revision.current && owner.current.session === id && owner.current.runtime === runtime) {
                setState((previous) => ({ session: id, runtime, controls: previous.session === id && previous.runtime === runtime ? previous.controls : undefined, error: error.message, changing: false }));
            }
        });
        return () => abort.abort();
    }, [session, runtime]);

    const change = React.useCallback(async (configId: string | null, value: string) => {
        if (!session || runtime?.generation !== 'acp' || pending.current) return;
        const id = session.id;
        const request = ++revision.current;
        pending.current = true;
        setState((previous) => ({ session: id, runtime, controls: previous.session === id && previous.runtime === runtime ? previous.controls : undefined, changing: true }));
        try {
            const controls = configId === null
                ? await opencodeClient.setAcpMode(id, value)
                : await opencodeClient.setAcpConfig(id, configId, value);
            if (request === revision.current && owner.current.session === id && owner.current.runtime === runtime) {
                setState({ session: id, runtime, controls, changing: false });
            }
        } catch (error) {
            if (request === revision.current && owner.current.session === id && owner.current.runtime === runtime) {
                setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : String(error), changing: false }));
            }
        } finally {
            pending.current = false;
        }
    }, [session, runtime]);

    const current = state.session === session?.id && state.runtime === runtime;
    return { controls: current ? state.controls : undefined, error: current ? state.error : undefined, changing: current && state.changing, change };
}
