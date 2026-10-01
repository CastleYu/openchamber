import { describe, expect, test } from 'bun:test';
import { routeOpenAgentManager } from './openAgentManagerCommand.ts';

const targets = () => {
  const calls = [];
  return {
    calls,
    handlers: {
      openOC1: () => calls.push('oc1'),
      openOC2: () => calls.push('oc2'),
      onNotReady: () => calls.push('not-ready'),
    },
  };
};

describe('routeOpenAgentManager', () => {
  test('keeps the Agent Manager command on OC1', async () => {
    const target = targets();
    const manager = {
      getKernelRuntime: () => ({ generation: 'oc1', endpoint: 'http://oc.test', epoch: 1 }),
      refreshKernelRuntime: async () => ({ generation: 'oc1', endpoint: 'http://oc.test', epoch: 1 }),
    };
    expect(await routeOpenAgentManager(manager, target.handlers)).toBe('oc1');
    expect(target.calls).toEqual(['oc1']);
  });

  test('opens the parallel draft only after OC2 is known', async () => {
    const target = targets();
    const manager = {
      getKernelRuntime: () => ({ generation: 'unknown', endpoint: 'http://oc.test', epoch: 1 }),
      refreshKernelRuntime: async () => ({ generation: 'oc2', endpoint: 'http://oc.test', epoch: 2 }),
    };
    expect(await routeOpenAgentManager(manager, target.handlers)).toBe('oc2');
    expect(target.calls).toEqual(['oc2']);
  });

  test('does not treat an unknown or unavailable kernel as OC2', async () => {
    const target = targets();
    const manager = {
      getKernelRuntime: () => ({ generation: 'unknown', endpoint: null, epoch: 1 }),
      refreshKernelRuntime: async () => { throw new Error('not ready'); },
    };
    expect(await routeOpenAgentManager(manager, target.handlers)).toBe('not-ready');
    expect(target.calls).toEqual(['not-ready']);
  });
});
