import { AGENT_ERROR, AGENT_EXTENSION } from '../../packages/web/server/lib/agent/constants.js';
import { extensionManifestSchema } from '../../packages/web/server/lib/agent/extensions.js';

export const EXTENSION_SAMPLE = Object.freeze({ ID: 'cagent.sample', FIELD: 'query', LABEL: 'cagent.sample.label', QUERY_LABEL: 'cagent.sample.query' });
/** A synthetic disabled template, never an API mapping or host registration. */
export function buildExtensionTemplate() {
  const manifest = extensionManifestSchema.parse({ version: AGENT_EXTENSION.VERSION, actionID: EXTENSION_SAMPLE.ID, revision: 'synthetic-r1',
    label: { key: EXTENSION_SAMPLE.LABEL, en: 'Synthetic sample', zhCN: '合成示例' },
    context: { workspace: true, session: false }, effect: AGENT_EXTENSION.EFFECT.READ, authorization: 'current-principal',
    cancellation: AGENT_EXTENSION.CANCELLATION.NONE, outcome: AGENT_EXTENSION.OUTCOME.OBSERVED,
    input: [{ key: EXTENSION_SAMPLE.FIELD, label: { key: EXTENSION_SAMPLE.QUERY_LABEL, en: 'Query', zhCN: '查询' }, required: true,
      value: { kind: AGENT_EXTENSION.KIND.TEXT, maxLength: 128 } }],
    output: { kind: AGENT_EXTENSION.KIND.TEXT, maxLength: 1024 }, evidence: [{ document: 'synthetic', section: 'unverified' }] });
  return new Map([
    ['templates/extension/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['templates/extension/input.json', JSON.stringify({ [EXTENSION_SAMPLE.FIELD]: 'synthetic' })],
    ['templates/extension/result.json', JSON.stringify({ text: 'Synthetic result, not a live response.' })],
    ['templates/extension/constants.mjs', `export const ACTION = Object.freeze(${JSON.stringify(EXTENSION_SAMPLE)});\n`],
    ['templates/extension/handler.mjs', `const REFUSAL = '${AGENT_ERROR.UNVERIFIED}';\nexport function createExtension(context) {\n  return async function handler(input, identity, control) {\n    void context; void input; void identity; void control;\n    throw new Error(REFUSAL);\n  };\n}\n`],
  ]);
}
