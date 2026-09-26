import { z } from 'zod';
import type { Agent } from '@/stores/useAgentsStore';

const number = z.number();

export const agentModelId = (agent?: Agent | null): string | undefined =>
  agent?.generation === 'oc2' ? agent.model?.id : agent?.model?.modelID;

export const agentVariant = (agent?: Agent | null): string | undefined =>
  agent?.generation === 'oc2' ? agent.model?.variant : agent?.variant;

export const agentPrompt = (agent?: Agent | null): string | undefined =>
  agent?.generation === 'oc2' ? agent.system : agent?.prompt;

export const agentTemperature = (agent?: Agent | null): number | undefined => {
  if (!agent) return undefined;
  if (agent.generation === 'oc1') return agent.temperature;
  const value = number.safeParse(agent.request.body.temperature);
  return value.success ? value.data : undefined;
};

export const agentTopP = (agent?: Agent | null): number | undefined => {
  if (!agent) return undefined;
  if (agent.generation === 'oc1') return agent.topP;
  const value = number.safeParse(agent.request.body.top_p);
  return value.success ? value.data : undefined;
};

type AgentPermissionSummary = { effect: 'allow' | 'ask' | 'deny'; custom: boolean };

export const agentPermission = (agent: Agent, action: string): AgentPermissionSummary => {
  if (agent.generation === 'oc2') {
    const key = action === 'bash' ? 'shell' : action;
    const rules = agent.permissions.filter((rule) => rule.action === key || rule.action === '*');
    const custom = rules.some((rule) => rule.action === key && rule.resource !== '*');
    const wildcard = rules.filter((rule) => rule.resource === '*').at(-1);
    return { effect: wildcard?.effect ?? 'ask', custom };
  }
  const rules = Array.isArray(agent.permission) ? agent.permission : [];
  const custom = rules.some((rule) => rule.permission === action && rule.pattern !== '*');
  const effect = rules.filter((rule) => (rule.permission === action || rule.permission === '*') && rule.pattern === '*').at(-1)?.action;
  return { effect: effect ?? 'ask', custom };
};
