import { z } from 'zod';

const str = (value) => z.string().trim().min(1).safeParse(value).data ?? null;
const modelRef = (value) => {
  if (z.string().safeParse(value).success) {
    const slash = value.indexOf('/');
    return slash > 0 && slash < value.length - 1
      ? { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) } : null;
  }
  const providerID = str(value?.providerID);
  const modelID = str(value?.model);
  return providerID && modelID ? { providerID, modelID } : null;
};

const findModel = (models, ref) => models.find((item) => item.providerID === ref.providerID && item.modelID === ref.modelID);
const variantOf = (models, ref, wanted) => {
  const variant = str(wanted);
  if (!variant) return undefined;
  const model = findModel(models, ref);
  if (!model) return variant;
  return model.variants?.some((item) => item.id === variant) ? variant : undefined;
};

export const validateV2Selection = ({ catalog, model, agent, variant, directory }) => {
  if (agent) {
    const found = catalog.agents.find((item) => item.id === agent);
    if (!found) throw Object.assign(new Error(`Unknown agent '${agent}' for ${directory}`), { statusCode: 400 });
    if (found.mode && found.mode !== 'primary' && found.mode !== 'all') {
      throw Object.assign(new Error(`Agent '${agent}' is a subagent and cannot receive a prompt directly`), { statusCode: 400 });
    }
  }
  if (model) {
    if (!findModel(catalog.models, model)) {
      throw Object.assign(new Error(`Unknown model '${model.providerID}/${model.modelID}' for ${directory}`), { statusCode: 400 });
    }
    if (variant && !variantOf(catalog.models, model, variant)) {
      throw Object.assign(new Error(`Unknown variant '${variant}' for model '${model.providerID}/${model.modelID}'`), { statusCode: 400 });
    }
  }
};

export const defaultV2Selection = ({ catalog, settings, projectDefaults }) => {
  const agents = catalog.agents;
  const models = catalog.models;
  const findAgent = (wanted) => wanted && (agents.find((item) => item.id === wanted)
    || agents.find((item) => item.name?.toLowerCase() === wanted.toLowerCase())
    || agents.find((item) => item.id?.toLowerCase() === wanted.toLowerCase()));
  let configAgent = null;
  let configModel = null;
  for (const entry of catalog.config) {
    if (str(entry.info?.default_agent)) configAgent = entry.info.default_agent;
    if (modelRef(entry.info?.model)) configModel = modelRef(entry.info.model);
  }
  const agent = findAgent(str(projectDefaults.defaultAgent))
    || findAgent(str(settings.defaultAgent))
    || findAgent(configAgent)
    || agents.find((item) => item.id === 'build' && item.hidden !== true)
    || agents.find((item) => item.hidden !== true && (!item.mode || item.mode === 'primary' || item.mode === 'all'))
    || agents[0];
  let model = null;
  let variant;
  for (const [candidate, chosenVariant] of [
    [projectDefaults.defaultModel, projectDefaults.defaultVariant],
    [settings.defaultModel, settings.defaultVariant],
  ]) {
    model = modelRef(candidate);
    if (model) { variant = variantOf(models, model, chosenVariant); break; }
  }
  if (!model && str(agent?.model?.providerID) && str(agent?.model?.id)) {
    model = { providerID: agent.model.providerID, modelID: agent.model.id };
    variant = variantOf(models, model, agent.model.variant);
  }
  model ||= configModel;
  if (!model) {
    const fallback = models.find((item) => item.providerID === 'opencode' && item.modelID === 'big-pickle') || models[0];
    if (fallback) model = { providerID: fallback.providerID, modelID: fallback.modelID };
  }
  return { model, agent: agent?.id, variant };
};
