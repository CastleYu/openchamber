import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AGENT_ERROR, AGENT_MUTATIONS, AGENT_OPERATION } from '../../packages/web/server/lib/agent/constants.js';
import { AGENT_FEATURE_RULES } from '../../packages/web/server/lib/agent/features.js';
import { AGENT_INPUT_SCHEMAS, AGENT_OUTPUT_SCHEMAS } from '../../packages/web/server/lib/agent/schemas.js';
import { OPERATION_REFERENCE } from './operation-reference.mjs';

export const CONTRACT_REFERENCE = Object.freeze({
  VERSION: 1,
  EN: 'docs/maintenance/cagent-contracts',
  ZH: 'docs/maintenance/zh-CN/cagent-contracts',
  MANIFEST: 'docs/maintenance/cagent-contracts/manifest.json',
});
const prose = z.object({ goal: z.string().min(1), semantics: z.array(z.string().min(1)).min(1) }).strict();
const catalog = z.record(z.enum(Object.values(AGENT_OPERATION)), z.object({
  en: prose, zh: prose, input: z.json(), output: z.json(), invalidOutput: z.json(),
}).strict());
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (text) => createHash('sha256').update(text).digest('hex');
const block = (value) => `\`\`\`json\n${json(value)}\`\`\``;

/** Generates references only. Runtime schemas and protected acceptance remain authoritative. */
export function buildContractPages() {
  const references = catalog.parse(OPERATION_REFERENCE);
  const files = new Map();
  for (const operation of Object.values(AGENT_OPERATION)) {
    const row = references[operation];
    AGENT_INPUT_SCHEMAS[operation].parse(row.input);
    AGENT_OUTPUT_SCHEMAS[operation].parse(row.output);
    if (AGENT_OUTPUT_SCHEMAS[operation].safeParse(row.invalidOutput).success) {
      throw new Error('Reference negative example must be rejected');
    }
    const inputSchema = z.toJSONSchema(AGENT_INPUT_SCHEMAS[operation]);
    const outputSchema = z.toJSONSchema(AGENT_OUTPUT_SCHEMAS[operation]);
    const features = Object.entries(AGENT_FEATURE_RULES).filter(([, rule]) =>
      rule.all.includes(operation) || rule.any.some((ids) => ids.includes(operation))).map(([id]) => id);
    const mutation = AGENT_MUTATIONS.includes(operation);
    const required = inputSchema.required ?? [];
    const optional = Object.keys(inputSchema.properties ?? {}).filter((key) => !required.includes(key));
    files.set(`${CONTRACT_REFERENCE.EN}/schemas/${operation}.json`, json({
      version: CONTRACT_REFERENCE.VERSION, operation, mutation, features,
      inputSchema, outputSchema, examples: { input: row.input, output: row.output, invalidOutput: row.invalidOutput },
      semantics: { en: row.en.semantics, zh: row.zh.semantics },
    }));
    for (const language of ['en', 'zh']) {
      const root = language === 'en' ? CONTRACT_REFERENCE.EN : CONTRACT_REFERENCE.ZH;
      const schemaPath = language === 'en' ? `schemas/${operation}.json` : `../../cagent-contracts/schemas/${operation}.json`;
      const labels = language === 'en' ? {
        goal: 'Goal', fields: 'Input fields', required: 'Required', optional: 'Optional', none: 'None',
        semantics: 'Required semantics', input: 'Valid input example', output: 'Valid result example',
        invalid: 'Rejected result example', features: 'Related action IDs', failures: 'Refusal examples',
        note: 'Fixture IDs are synthetic. This page defines no CAgent API route or support claim.',
        schema: 'Generated JSON schema and examples',
        validation: 'JSON schema describes structure. Runtime parsers also enforce refinements such as unique IDs; protected fixtures must test semantics and request fidelity.',
        effect: 'Persist the original request ID before dispatch. An entered failure is an unknown outcome. Acceptance does not establish completion; resolve the original request without replay.',
        read: 'Read failure must remain a failure. Never replace it with empty successful data.',
        host: 'These are host refusals, not CAgent wire errors. The local API documentation must define the wire error mapping.',
      } : {
        goal: '目标', fields: '输入字段', required: '必需', optional: '可选', none: '无',
        semantics: '必需语义', input: '有效输入样例', output: '有效结果样例',
        invalid: '拒绝的结果样例', features: '相关操作功能 ID', failures: '拒绝样例',
        note: '夹具 ID 均为合成值。本页不定义 CAgent API 路径，也不声明支持状态。',
        schema: '生成的 JSON schema 与样例',
        validation: 'JSON schema 描述结构。运行时解析器还执行 ID 唯一性等细化检查；受保护夹具必须验证语义及请求保真。',
        effect: '分发前持久化原请求 ID。已经进入的失败属于结果未知。接收不证明完成；查询原请求结果，不重发。',
        read: '读取失败必须保持为失败，不能替换成空的成功数据。',
        host: '这些是宿主拒绝，并非 CAgent 线协议错误。线协议错误映射须来自本地 API 文档。',
      };
      files.set(`${root}/${operation}.md`, [
        `# ${operation}`, '', labels.note, '', `## ${labels.goal}`, '', row[language].goal, '',
        `## ${labels.fields}`, '', `${labels.required}: ${required.join(', ') || labels.none}`, '',
        `${labels.optional}: ${optional.join(', ') || labels.none}`, '',
        `[${labels.schema}](${schemaPath})`, '', labels.validation, '',
        `## ${labels.semantics}`, '', ...row[language].semantics.map((line) => `- ${line}`), '',
        mutation ? labels.effect : labels.read, '', `## ${labels.input}`, '', block(row.input), '',
        `## ${labels.output}`, '', block(row.output), '', `## ${labels.invalid}`, '', block(row.invalidOutput), '',
        `## ${labels.features}`, '', features.join(', ') || labels.none, '',
        `## ${labels.failures}`, '', labels.host, '',
        block({ error: AGENT_ERROR.UNVERIFIED }), '', block({ error: AGENT_ERROR.UNSUPPORTED }), '', block({ error: AGENT_ERROR.BACKEND_FAILED }), '',
      ].join('\n'));
    }
  }
  for (const [language, root] of [['en', CONTRACT_REFERENCE.EN], ['zh', CONTRACT_REFERENCE.ZH]]) {
    files.set(`${root}/README.md`, [
      language === 'en' ? '# CAgent operation references' : '# CAgent 操作契约参考', '',
      language === 'en'
        ? 'Generated from the current operation schemas, action dependency rules and reviewed bilingual semantics. Read only the operation assigned by your protected packet. These references grant no capability or activation.'
        : '由当前操作 schema、功能依赖规则及已审查的双语语义生成。只读取受保护任务包指定的操作。本参考不授予能力或启用许可。', '',
      ...Object.values(AGENT_OPERATION).map((operation) => `- [${operation}](${operation}.md)`), '',
    ].join('\n'));
  }
  const entries = [...files].map(([path, text]) => ({ path, sha256: hash(text) }));
  const digest = hash(JSON.stringify(entries));
  files.set(CONTRACT_REFERENCE.MANIFEST, json({ version: CONTRACT_REFERENCE.VERSION, digest, operations: Object.values(AGENT_OPERATION), files: entries }));
  return Object.freeze({ files, digest });
}
