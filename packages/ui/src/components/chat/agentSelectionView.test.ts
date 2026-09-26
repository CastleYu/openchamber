import { describe, expect, test } from 'bun:test';
import type { Agent } from '@/stores/useAgentsStore';
import { agentModelId, agentPermission, agentPrompt, agentTemperature, agentTopP, agentVariant } from './agentSelectionView';

const agent: Agent = {
  generation: 'oc2', id: 'build', name: 'build', displayName: 'Build', mode: 'primary', hidden: false,
  model: { providerID: 'openai', id: 'gpt', variant: 'fast' },
  system: 'Stored system prompt',
  request: { settings: {}, headers: {}, body: { temperature: 0.4, top_p: 0.8 } },
  permissions: [
    { action: 'shell', resource: '*', effect: 'ask' },
    { action: 'shell', resource: 'git push *', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'allow' },
  ],
};

describe('OC2 agent selection view', () => {
  test('keeps the bare model id and variant without losing the model ref', () => {
    expect(agentModelId(agent)).toBe('gpt');
    expect(agentVariant(agent)).toBe('fast');
    expect(agent.model).toEqual({ providerID: 'openai', id: 'gpt', variant: 'fast' });
  });

  test('reads request body values and system prompt', () => {
    expect(agentTemperature(agent)).toBe(0.4);
    expect(agentTopP(agent)).toBe(0.8);
    expect(agentPrompt(agent)).toBe('Stored system prompt');
  });

  test('shows the last tool-wide decision and detects resource exceptions', () => {
    expect(agentPermission(agent, 'bash')).toEqual({ effect: 'allow', custom: true });
  });
});
