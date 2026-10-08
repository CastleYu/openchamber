import React, { act, StrictMode } from 'react';
import { describe, expect, test } from 'bun:test';
import { createRoot } from 'react-dom/client';
import { AGENT_FAMILY } from '../../../web/server/lib/agent/constants.js';
import { AgentClient, type AgentClientPorts } from '@/lib/agent/client';
import { I18nProvider } from '@/lib/i18n';
import { installHookTestDom } from '@/components/session/sidebar/test-utils/testDom';
import { AgentBootstrap } from './agentBootstrap';
import { BackendGate } from './BackendGate';

const selection = (family: string) => new Response(JSON.stringify({ family, revision: 1 }));
const deferred = () => {
  let release: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => { release = resolve; });
  return { promise, release: (response: Response) => release(response) };
};

class BootstrapHarness {
  readonly runtimeKey = 'backend-gate-test';
  readonly calls: Array<AbortSignal | null> = [];
  readonly owners: AgentBootstrap[] = [];
  retire: (() => void) | null = null;
  change: (() => void) | null = null;
  retireUnsubscribes = 0;
  changeUnsubscribes = 0;

  constructor(private readonly fetcher: AgentClientPorts['fetch']) {}

  create = (): AgentBootstrap => {
    const client = new AgentClient({
      getRuntimeKey: () => this.runtimeKey,
      subscribe: (listener) => {
        this.retire = listener;
        return () => { this.retireUnsubscribes += 1; };
      },
      fetch: (path, options) => {
        this.calls.push(options?.signal ?? null);
        return this.fetcher(path, options);
      },
    } satisfies AgentClientPorts);
    const owner = new AgentBootstrap(client, (listener) => {
      this.change = listener;
      return () => { this.changeUnsubscribes += 1; };
    });
    this.owners.push(owner);
    return owner;
  };
}

const lazyChild = () => {
  let evaluated = 0;
  let mounted = 0;
  let unmounted = 0;
  const Child = () => {
    React.useEffect(() => {
      mounted += 1;
      return () => { unmounted += 1; };
    }, []);
    return null;
  };
  const Component = React.lazy(async () => {
    evaluated += 1;
    return { default: Child };
  });
  return { element: <Component />, counts: () => ({ evaluated, mounted, unmounted }) };
};

const mount = async (harness: BootstrapHarness, child: React.ReactNode, strict = false) => {
  const dom = installHookTestDom();
  const root = createRoot(dom.container);
  const content = <I18nProvider><BackendGate create={harness.create}>{child}</BackendGate></I18nProvider>;
  await act(async () => root.render(strict ? <StrictMode>{content}</StrictMode> : content));
  return {
    dom,
    unmount: async () => {
      await act(async () => root.unmount());
      dom.restore();
    },
  };
};

describe('BackendGate lifecycle', () => {
  test('does not evaluate the OpenCode child while selection is pending, CAgent, or failed', async () => {
    const pending = deferred();
    const responses = [pending.promise, Promise.resolve(selection(AGENT_FAMILY.CAGENT)), Promise.resolve(new Response('{}', { status: 503 }))];
    const harness = new BootstrapHarness(async () => responses.shift() ?? selection(AGENT_FAMILY.OPENCODE));
    const child = lazyChild();
    const view = await mount(harness, child.element);
    try {
      expect(harness.calls).toHaveLength(1);
      expect(child.counts()).toEqual({ evaluated: 0, mounted: 0, unmounted: 0 });
      pending.release(selection(AGENT_FAMILY.CAGENT));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(harness.owners[0]?.getSnapshot().state).toBe('selected');
      expect(child.counts()).toEqual({ evaluated: 0, mounted: 0, unmounted: 0 });

      await act(async () => { harness.change?.(); await Promise.resolve(); await Promise.resolve(); });
      expect(harness.calls).toHaveLength(2);
      expect(child.counts()).toEqual({ evaluated: 0, mounted: 0, unmounted: 0 });

      await act(async () => { harness.change?.(); await Promise.resolve(); await Promise.resolve(); });
      expect(harness.calls).toHaveLength(3);
      expect(harness.owners[0]?.getSnapshot().state).toBe('failed');
      expect(child.counts()).toEqual({ evaluated: 0, mounted: 0, unmounted: 0 });
    } finally {
      await view.unmount();
    }
  });

  test('mounts only after OpenCode selection and retires the mounted child without accepting a stale response', async () => {
    const delayed = deferred();
    let call = 0;
    const harness = new BootstrapHarness(async () => {
      call += 1;
      return call === 1 ? selection(AGENT_FAMILY.OPENCODE) : delayed.promise;
    });
    const child = lazyChild();
    const view = await mount(harness, child.element);
    try {
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(child.counts()).toEqual({ evaluated: 1, mounted: 1, unmounted: 0 });

      await act(async () => { harness.change?.(); });
      expect(child.counts()).toEqual({ evaluated: 1, mounted: 1, unmounted: 1 });
      expect(harness.calls).toHaveLength(2);
      await act(async () => { harness.retire?.(); });
      expect(child.counts()).toEqual({ evaluated: 1, mounted: 1, unmounted: 1 });
      delayed.release(selection(AGENT_FAMILY.OPENCODE));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(child.counts()).toEqual({ evaluated: 1, mounted: 1, unmounted: 1 });
    } finally {
      await view.unmount();
    }
  });

  test('StrictMode discards the disposed bootstrap before a fresh owner selects', async () => {
    const delayed = deferred();
    let calls = 0;
    const harness = new BootstrapHarness(async () => {
      calls += 1;
      return calls === 1 ? delayed.promise : selection(AGENT_FAMILY.CAGENT);
    });
    const child = lazyChild();
    const view = await mount(harness, child.element, true);
    try {
      expect(harness.owners).toHaveLength(2);
      expect(harness.retireUnsubscribes).toBe(1);
      expect(harness.changeUnsubscribes).toBe(1);
      expect(harness.calls).toHaveLength(2);
      expect(harness.owners[1]?.getSnapshot()).toMatchObject({ state: 'selected', value: { selection: { family: AGENT_FAMILY.CAGENT } } });
      expect(child.counts()).toEqual({ evaluated: 0, mounted: 0, unmounted: 0 });

      delayed.release(selection(AGENT_FAMILY.OPENCODE));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(child.counts()).toEqual({ evaluated: 0, mounted: 0, unmounted: 0 });
      expect(harness.owners[0]?.getSnapshot()).toEqual({ state: 'loading' });
    } finally {
      await view.unmount();
    }
  });
});
