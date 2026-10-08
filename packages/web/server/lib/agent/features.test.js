import { describe, expect, it, vi } from 'vitest';

import { AGENT_ERROR, AGENT_FAMILY, AGENT_FEATURE, AGENT_OPERATION, AGENT_SUPPORT } from './constants.js';
import { createAgentDispatcher } from './dispatcher.js';
import { AGENT_FEATURE_RULES, createAgentFeatures } from './features.js';

const identity = () => ({
  family: AGENT_FAMILY.CAGENT,
  connectionID: 'connection-1',
  epoch: 1,
  adapterRevision: 'adapter-1',
  capabilityRevision: 'capability-1',
});

const binding = () => {
  const currentIdentity = identity();
  const operations = Object.values(AGENT_OPERATION);
  return {
    identity: currentIdentity,
    ready: true,
    authorized: true,
    capabilities: Object.fromEntries(operations.map((operation) => [operation, {
      state: AGENT_SUPPORT.SUPPORTED,
      evidence: ['host-fixture'],
    }])),
    acceptance: {
      adapterRevision: currentIdentity.adapterRevision,
      capabilityRevision: currentIdentity.capabilityRevision,
      operations,
    },
    handlers: Object.fromEntries(operations.map((operation) => [operation, vi.fn()])),
  };
};

const makeFeatures = (current, { attempts, host = () => ({ identity: current.identity, implemented: Object.values(AGENT_FEATURE) }) } = {}) => {
  const dispatcher = createAgentDispatcher({ getBinding: () => current, attempts });
  return createAgentFeatures({ getRuntime: () => dispatcher.describeRuntime(), getHostSupport: host });
};

const errorCode = (callback, code) => {
  expect(callback).toThrow(expect.objectContaining({ code }));
};

describe('agent host feature dependencies', () => {
  it('refuses incomplete runtime inventories before consulting host implementation support', () => {
    const current = binding();
    const runtime = createAgentDispatcher({ getBinding: () => current }).describeRuntime();
    delete runtime.operations[AGENT_OPERATION.GET_MESSAGE];
    const host = vi.fn(() => ({ identity: current.identity, implemented: Object.values(AGENT_FEATURE) }));
    const features = createAgentFeatures({ getRuntime: () => runtime, getHostSupport: host });
    errorCode(() => features.describe(), AGENT_ERROR.INVALID_RESPONSE);
    expect(host).not.toHaveBeenCalled();
    for (const handler of Object.values(current.handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('requires every all dependency and at least one acquireSession alternative', () => {
    const allOperations = new Set();
    for (const [featureID, dependency] of Object.entries(AGENT_FEATURE_RULES)) {
      for (const operation of dependency.all) allOperations.add(operation);
      for (const group of dependency.any) for (const operation of group) allOperations.add(operation);

      for (const operation of dependency.all) {
        const current = binding();
        current.acceptance.operations = current.acceptance.operations.filter((item) => item !== operation);
        const snapshot = makeFeatures(current, { attempts: {} }).describe();
        expect(snapshot.features[featureID]).toEqual({ available: false, reason: AGENT_ERROR.UNACCEPTED });
      }
    }
    expect([...allOperations].sort()).toEqual(Object.values(AGENT_OPERATION).sort());

    for (const availableOperation of [AGENT_OPERATION.CREATE_SESSION, AGENT_OPERATION.GET_SESSION]) {
      const current = binding();
      current.acceptance.operations = [availableOperation];
      const snapshot = makeFeatures(current, { attempts: {} }).describe();
      expect(snapshot.features[AGENT_FEATURE.ACQUIRE_SESSION]).toEqual({ available: true });
    }
    const current = binding();
    current.acceptance.operations = [];
    expect(makeFeatures(current, { attempts: {} }).describe().features[AGENT_FEATURE.ACQUIRE_SESSION])
      .toEqual({ available: false, reason: AGENT_ERROR.DEPENDENCY });
  });

  it('marks every feature unmigrated when host support is absent or invalid', () => {
    const cases = [
      () => null,
      () => ({ identity: identity(), implemented: [AGENT_FEATURE.PROMPT, AGENT_FEATURE.PROMPT] }),
      () => ({ identity: identity(), implemented: ['future-feature'] }),
    ];
    for (const host of cases) {
      const snapshot = makeFeatures(binding(), { host }).describe();
      for (const availability of Object.values(snapshot.features)) {
        expect(availability).toEqual({ available: false, reason: AGENT_ERROR.UNMIGRATED });
      }
    }
    errorCode(() => makeFeatures(binding(), { host: () => { throw new Error('host support unavailable'); } }).describe(), AGENT_ERROR.UNAVAILABLE);
  });

  it('rejects host support for a different backend identity', () => {
    const current = binding();
    const hostIdentity = { ...current.identity, epoch: current.identity.epoch + 1 };
    const features = makeFeatures(current, { host: () => ({ identity: hostIdentity, implemented: Object.values(AGENT_FEATURE) }) });
    errorCode(() => features.describe(), AGENT_ERROR.CHANGED);
  });

  it('covers the feature list and freezes snapshots, feature entries, and rules', () => {
    const current = binding();
    const getBinding = vi.fn(() => current);
    const dispatcher = createAgentDispatcher({ getBinding, attempts: { begin: vi.fn() } });
    const features = createAgentFeatures({
      getRuntime: () => dispatcher.describeRuntime(),
      getHostSupport: () => ({ identity: current.identity, implemented: Object.values(AGENT_FEATURE) }),
    });
    const snapshot = features.describe();

    expect(Object.keys(snapshot.features).sort()).toEqual(Object.values(AGENT_FEATURE).sort());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.identity)).toBe(true);
    expect(Object.isFrozen(snapshot.features)).toBe(true);
    for (const entry of Object.values(snapshot.features)) expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(AGENT_FEATURE_RULES)).toBe(true);
    for (const dependency of Object.values(AGENT_FEATURE_RULES)) {
      expect(Object.isFrozen(dependency)).toBe(true);
      expect(Object.isFrozen(dependency.all)).toBe(true);
      for (const group of dependency.any) expect(Object.isFrozen(group)).toBe(true);
    }
    expect(getBinding).toHaveBeenCalledTimes(1);
    for (const handler of Object.values(current.handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ['family', AGENT_FAMILY.OPENCODE],
    ['connectionID', 'connection-2'],
    ['epoch', 2],
    ['adapterRevision', 'adapter-2'],
    ['capabilityRevision', 'capability-2'],
  ])('rejects a stale expected identity when %s changes', (field, value) => {
    const current = binding();
    const expected = { ...current.identity };
    current.identity[field] = value;
    const features = makeFeatures(current);
    errorCode(() => features.requireFeature(AGENT_FEATURE.ACTIVITY, expected), AGENT_ERROR.CHANGED);
  });

  it('re-reads current runtime authority when requiring a previously available feature', () => {
    const current = binding();
    const features = makeFeatures(current);
    const snapshot = features.describe();
    expect(snapshot.features[AGENT_FEATURE.ACTIVITY]).toEqual({ available: true });

    current.acceptance.operations = current.acceptance.operations.filter((item) => item !== AGENT_OPERATION.LIST_ACTIVE_STATUSES);
    errorCode(() => features.requireFeature(AGENT_FEATURE.ACTIVITY, snapshot.identity), AGENT_ERROR.UNACCEPTED);
    for (const handler of Object.values(current.handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('rejects unknown features and malformed expected identities', () => {
    const features = makeFeatures(binding());
    errorCode(() => features.requireFeature('not-a-feature', identity()), AGENT_ERROR.UNKNOWN_FEATURE);
    errorCode(() => features.requireFeature(AGENT_FEATURE.ACTIVITY, {}), AGENT_ERROR.INVALID_INPUT);
  });

  it('blocks mutation-dependent features when no attempt ledger exists', () => {
    const current = binding();
    const features = makeFeatures(current);
    const snapshot = features.describe();
    expect(snapshot.features[AGENT_FEATURE.PROMPT]).toEqual({ available: false, reason: AGENT_ERROR.WRITE_UNAVAILABLE });
    errorCode(() => features.requireFeature(AGENT_FEATURE.PROMPT, snapshot.identity), AGENT_ERROR.WRITE_UNAVAILABLE);
    for (const handler of Object.values(current.handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('keeps unrelated features available when one dependency fails', () => {
    const current = binding();
    current.acceptance.operations = current.acceptance.operations.filter((item) => item !== AGENT_OPERATION.GET_SESSION);
    const snapshot = makeFeatures(current).describe();
    expect(snapshot.features[AGENT_FEATURE.HISTORY]).toEqual({ available: false, reason: AGENT_ERROR.UNACCEPTED });
    expect(snapshot.features[AGENT_FEATURE.ACTIVITY]).toEqual({ available: true });
  });
});
