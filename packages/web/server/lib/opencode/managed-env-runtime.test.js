import { describe, expect, it } from 'vitest';
import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_GENERATION } from './compatibility.js';
import { createManagedOpenCodeEnv } from './managed-env-runtime.js';

const SETTINGS = Object.freeze({
  CONTROL: 'agentControlToolEnabled',
  WEB: 'agentWebToolEnabled',
  MEMORY: 'agentMemoryToolEnabled',
  OPTIMIZE: 'optimizeSystemPrompt',
});
const CONFIG = Object.freeze({ CONTENT: 'OPENCODE_CONFIG_CONTENT' });
const FAMILY = Object.freeze({ OPENCODE: AGENT_FAMILY.OPENCODE, CAGENT: AGENT_FAMILY.CAGENT });
const GENERATION = Object.freeze({ OC1: OPENCODE_GENERATION.OC1, OC2: OPENCODE_GENERATION.OC2, UNKNOWN: OPENCODE_GENERATION.UNKNOWN });

const createHarness = (options = {}) => {
  const calls = [];
  let selection = options.selection ?? { family: FAMILY.OPENCODE, revision: 1 };
  let settings = options.settings ?? {};
  const deps = {
    getBackendSelection: () => selection,
    readSettings: options.readSettings ?? (async () => settings),
    isMemoryAvailable: options.isMemoryAvailable ?? (() => true),
    prepareTools: options.prepareTools ?? (async (flags) => { calls.push(['tools', flags]); return { [CONFIG.CONTENT]: 'tools-config' }; }),
    preparePrompt: options.preparePrompt ?? (async (config) => { calls.push(['prompt', config]); return { prompt: 'prepared' }; }),
    prepareMcp: options.prepareMcp ?? (async (config) => { calls.push(['mcp', config]); return { mcp: 'prepared' }; }),
    prepareOc2: options.prepareOc2 ?? (async () => { calls.push(['oc2']); return { oc2: true }; }),
    getConfigContent: options.getConfigContent ?? (() => { calls.push(['config']); return 'fallback-config'; }),
  };
  return {
    calls,
    run: createManagedOpenCodeEnv(deps),
    select: (next) => { selection = next; },
    configure: (next) => { settings = next; },
  };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const untilCalled = async (calls, name) => {
  for (let turn = 0; turn < 20; turn += 1) {
    if (calls.some(([called]) => called === name)) return;
    await Promise.resolve();
  }
  throw new Error(`Preparation did not enter ${name}`);
};

describe('managed OpenCode environment runtime', () => {
  it('refuses CAgent before settings, memory, or preparers', async () => {
    const h = createHarness({
      selection: { family: FAMILY.CAGENT, revision: 1 },
      readSettings: async () => { h.calls.push(['settings']); return {}; },
      isMemoryAvailable: () => { h.calls.push(['memory']); return true; },
    });
    await expect(h.run({ generation: GENERATION.OC1 })).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(h.calls).toEqual([]);
  });

  it('rejects unknown generation without starting any preparation', async () => {
    const h = createHarness({
      readSettings: async () => { h.calls.push(['settings']); return {}; },
      isMemoryAvailable: () => { h.calls.push(['memory']); return true; },
    });
    await expect(h.run({ generation: GENERATION.UNKNOWN })).rejects.toMatchObject({ code: AGENT_ERROR.UNAVAILABLE });
    expect(h.calls).toEqual([]);
  });

  it('uses only OC2 preparation and rejects a retired result', async () => {
    const gate = deferred();
    const h = createHarness({ prepareOc2: () => { h.calls.push(['oc2']); return gate.promise; } });
    const pending = h.run({ generation: GENERATION.OC2 });
    await Promise.resolve();
    h.select({ family: FAMILY.OPENCODE, revision: 2 });
    gate.resolve({ oc2: true });
    await expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(h.calls).toEqual([['oc2']]);
  });

  it('returns the current OC2 environment without reading OC1 settings', async () => {
    const h = createHarness({ readSettings: async () => { h.calls.push(['settings']); return {}; } });
    await expect(h.run({ generation: GENERATION.OC2 })).resolves.toEqual({ oc2: true });
    expect(h.calls).toEqual([['oc2']]);
  });

  it('skips tools when their switches are off and memory is unavailable', async () => {
    const h = createHarness({
      settings: { [SETTINGS.CONTROL]: false, [SETTINGS.WEB]: false, [SETTINGS.MEMORY]: true },
      isMemoryAvailable: () => false,
    });
    await h.run({ generation: GENERATION.OC1 });
    expect(h.calls).toEqual([['config'], ['mcp', 'fallback-config']]);
  });

  it('keeps OC1 switches, config merge order, and prompt config content', async () => {
    const h = createHarness({ settings: {
      [SETTINGS.CONTROL]: false, [SETTINGS.WEB]: true, [SETTINGS.MEMORY]: true, [SETTINGS.OPTIMIZE]: true,
    } });
    const result = await h.run({ generation: GENERATION.OC1 });
    expect(h.calls).toEqual([
      ['tools', { includeControl: false, includeWeb: true, includeMemory: true }],
      ['prompt', 'tools-config'], ['mcp', 'tools-config'],
    ]);
    expect(result).toEqual({ [CONFIG.CONTENT]: 'tools-config', prompt: 'prepared', mcp: 'prepared' });
  });

  it('uses config content fallback when preparation supplies none', async () => {
    const h = createHarness({
      settings: { [SETTINGS.OPTIMIZE]: true },
      prepareTools: async (flags) => { h.calls.push(['tools', flags]); return {}; },
    });
    await h.run({ generation: GENERATION.OC1 });
    expect(h.calls).toEqual([
      ['tools', { includeControl: true, includeWeb: true, includeMemory: false }],
      ['config'], ['prompt', 'fallback-config'], ['config'], ['mcp', 'fallback-config'],
    ]);
  });

  it('retains default tool behavior when settings cannot be read', async () => {
    const h = createHarness({ readSettings: async () => { throw new Error('settings unavailable'); } });
    await h.run({ generation: GENERATION.OC1 });
    expect(h.calls).toEqual([
      ['tools', { includeControl: true, includeWeb: true, includeMemory: false }],
      ['mcp', 'tools-config'],
    ]);
  });

  it.each(['settings', 'tools', 'prompt'])('stops subsequent side effects after selection changes during %s await', async (stage) => {
    const gate = deferred();
    const options = { settings: { [SETTINGS.OPTIMIZE]: true } };
    if (stage === 'settings') options.readSettings = () => { h.calls.push(['settings']); return gate.promise; };
    if (stage === 'tools') options.prepareTools = () => { h.calls.push(['tools']); return gate.promise; };
    if (stage === 'prompt') options.preparePrompt = () => { h.calls.push(['prompt']); return gate.promise; };
    const h = createHarness(options);
    const pending = h.run({ generation: GENERATION.OC1 });
    await untilCalled(h.calls, stage === 'settings' ? 'settings' : stage === 'tools' ? 'tools' : 'prompt');
    h.select({ family: FAMILY.OPENCODE, revision: 2 });
    gate.resolve({});
    await expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(h.calls.some(([name]) => name === 'mcp')).toBe(false);
    if (stage === 'settings') expect(h.calls).toEqual([['settings']]);
    if (stage === 'tools') expect(h.calls).toEqual([['tools']]);
    if (stage === 'prompt') expect(h.calls.map(([name]) => name)).toEqual(['tools', 'prompt']);
  });

  it('refuses an MCP result completed after the selected family changes', async () => {
    const gate = deferred();
    const h = createHarness({ prepareMcp: () => { h.calls.push(['mcp']); return gate.promise; } });
    const pending = h.run({ generation: GENERATION.OC1 });
    await untilCalled(h.calls, 'mcp');
    h.select({ family: FAMILY.CAGENT, revision: 1 });
    gate.resolve({ mcp: true });
    await expect(pending).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
    expect(h.calls.map(([name]) => name)).toEqual(['tools', 'mcp']);
  });
});
