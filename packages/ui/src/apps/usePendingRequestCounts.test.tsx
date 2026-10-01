import { describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import type { Event } from '@opencode-ai/sdk/v2/client';
import type { FormInfo } from '@opencode/client';
import { createRoot } from 'react-dom/client';
import { applyGlobalBlockingRequestEvents, applyGlobalDomainBlockingEvents, resetGlobalBlockingRequests } from '@/sync/global-blocking-requests';
import { installHookTestDom } from '@/components/session/sidebar/test-utils/testDom';
import { usePendingRequestCounts, type PendingRequestCounts } from './usePendingRequestCounts';

const FAMILY = ['parent', 'child'] as const;
const askPermission = (id: string, sessionID: string): Event => ({
  id: `event-${id}`,
  type: 'permission.asked',
  properties: { id, sessionID, permission: 'bash', patterns: ['rm *'], metadata: {}, always: [] },
});

describe('usePendingRequestCounts', () => {
  test('counts the whole family, ignores other sessions, and clears on reply', async () => {
    const dom = installHookTestDom();
    const root = createRoot(dom.container);
    type CountsCapture = { renders: number; counts: PendingRequestCounts | null };
    const capture: CountsCapture = { renders: 0, counts: null };
    const Harness = () => {
      capture.renders += 1;
      capture.counts = usePendingRequestCounts(FAMILY);
      return null;
    };
    try {
      await act(async () => root.render(React.createElement(Harness)));
      expect(capture.counts).toEqual({ permissionCount: 0, formCount: 0 });

      // A request in an unrelated session neither counts nor re-renders the row.
      const idleRenders = capture.renders;
      await act(async () => applyGlobalBlockingRequestEvents('/other', [askPermission('p-other', 'unrelated')]));
      expect(capture.renders).toBe(idleRenders);

      // A subagent's permission and the parent's question both land on the row.
      await act(async () => applyGlobalBlockingRequestEvents('/workspace', [
        askPermission('p1', 'child'),
      ]));
      const form: FormInfo = {
        id: 'q1', sessionID: 'parent', title: 'Pick',
        fields: [{ key: 'answer', type: 'boolean' }],
      };
      await act(async () => applyGlobalDomainBlockingEvents('/workspace', [{
        type: 'input-created', eventID: 'f1',
        request: { generation: 'oc2', kind: 'form', value: form },
      }]));
      expect(capture.counts).toEqual({ permissionCount: 1, formCount: 1 });

      await act(async () => applyGlobalBlockingRequestEvents('/workspace', [
        { id: 'reply-p1', type: 'permission.replied', properties: { sessionID: 'child', requestID: 'p1', reply: 'once' } },
      ]));
      await act(async () => applyGlobalDomainBlockingEvents('/workspace', [{
        type: 'form-closed', eventID: 'f2', sessionID: 'parent', requestID: 'q1',
      }]));
      expect(capture.counts).toEqual({ permissionCount: 0, formCount: 0 });
    } finally {
      await act(async () => root.unmount());
      resetGlobalBlockingRequests();
      dom.restore();
    }
  });
});
