import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';
import { OPENCODE_GENERATION } from './compatibility.js';

export const createManagedOpenCodeEnv = ({
  getBackendSelection,
  readSettings,
  isMemoryAvailable,
  prepareTools,
  preparePrompt,
  prepareMcp,
  prepareOc2,
  getConfigContent,
}) => async (kernel) => {
  const selected = getBackendSelection();
  const requireCurrent = () => {
    const current = getBackendSelection();
    if (selected.family !== AGENT_FAMILY.OPENCODE
      || current.family !== selected.family || current.revision !== selected.revision) {
      const error = new Error('OpenCode configuration selection is unavailable or retired');
      error.code = AGENT_ERROR.CHANGED;
      throw error;
    }
  };
  requireCurrent();
  if (kernel.generation === OPENCODE_GENERATION.OC2) {
    const env = await prepareOc2();
    requireCurrent();
    return env;
  }
  if (kernel.generation !== OPENCODE_GENERATION.OC1) {
    const error = new Error('OpenCode configuration generation is unavailable');
    error.code = AGENT_ERROR.UNAVAILABLE;
    throw error;
  }
  const settings = await readSettings().catch(() => null);
  requireCurrent();
  const includeControl = settings?.agentControlToolEnabled !== false;
  const includeWeb = settings?.agentWebToolEnabled !== false;
  const includeMemory = isMemoryAvailable() && settings?.agentMemoryToolEnabled === true;
  const env = includeControl || includeWeb || includeMemory
    ? await prepareTools({ includeControl, includeWeb, includeMemory }) : {};
  requireCurrent();
  if (settings?.optimizeSystemPrompt === true) {
    const prompt = await preparePrompt(env.OPENCODE_CONFIG_CONTENT ?? getConfigContent());
    requireCurrent();
    Object.assign(env, prompt);
  }
  const mcp = await prepareMcp(env.OPENCODE_CONFIG_CONTENT ?? getConfigContent());
  requireCurrent();
  Object.assign(env, mcp);
  return env;
};
