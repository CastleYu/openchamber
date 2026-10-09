import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isBuiltin } from 'node:module';
import { createHash } from 'node:crypto';
import { agentArtifactDigest, agentArtifactManifestSchema } from '../../packages/web/server/lib/agent/artifacts.js';
import { AGENT_ARTIFACT } from '../../packages/web/server/lib/agent/constants.js';
import { buildContractPages } from './contract-pages.mjs';

export const KIT = Object.freeze({
  ROOT: fileURLToPath(new URL('../../', import.meta.url)),
  COMMANDS: Object.freeze(['build-contracts', 'check-mapping', 'prepare-packets', 'check-packet', 'fixture-worker', 'finalize-adapter', 'verify-kit']),
  LICENSES: Object.freeze(['LICENSE', 'node_modules/zod/LICENSE', 'node_modules/typescript/LICENSE.txt']),
  ERROR: Object.freeze({ INVALID: 'invalid-arguments', EXISTS: 'kit-exists', BOUNDARY: 'kit-boundary', BUILD: 'kit-build-failed', INCOMPLETE: 'kit-incomplete' }),
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const starts = (zh) => zh ? `# CAgent 离线命令包

此包包含已打包依赖的宿主命令及双语操作参考，无需安装项目依赖。维护者另行准备经过验证的 Node 24.9.0 和 Bun 1.3.14。其他版本须先验证。
宿主将整个 protected 目录设为候选只读，并将 control、进度及批准目录置于候选写权限之外。摘要须从独立可信渠道取得。权限模型不能证明网络隔离或恶意代码沙箱。
此包未包含真实 CAgent API、模型校准、扩展模板或真实验收。通过合成夹具不能启用功能。

在 protected 目录执行以下命令。填写维护者审阅的本地文档目录、映射、夹具及独立摘要。工作区和制品输出须位于此包之外。
` : `# CAgent offline command bundle

This bundle contains host commands with their dependencies and bilingual operation references. No project package installation is needed. The owner separately supplies validated Node 24.9.0 and Bun 1.3.14 executables. Validate other versions before use.
The host makes the entire protected directory read-only to the candidate and keeps control, progress and approvals outside candidate write authority. Obtain the digest through an independent trusted channel. The permission model does not establish network isolation or a hostile-code sandbox.
This bundle contains no real CAgent API, model calibration, extension templates or live acceptance. Passing synthetic fixtures grants no feature activation.

Run these commands from protected. Supply owner-reviewed local documentation catalog, mapping, fixtures and independent digest. Workspace and artifact outputs must be outside this bundle.
`;
const commands = `
\`\`\`sh
node scripts/cagent/verify-kit.mjs --kit <bundle-root> --digest <owner-digest> --json
node scripts/cagent/build-contracts.mjs --check --json
node scripts/cagent/check-mapping.mjs --catalog <catalog> --mapping <mapping> --json
node scripts/cagent/prepare-packets.mjs --catalog <catalog> --mapping <mapping> --fixtures <fixtures> --out <new-workspace> --json
bun scripts/cagent/check-packet.mjs --workspace <workspace> --operation <operation> --node <absolute-node> --kit-digest <workspace-digest> --json
bun scripts/cagent/finalize-adapter.mjs --workspace <workspace> --node <absolute-node> --kit-digest <workspace-digest> --out <new-artifact> --json
\`\`\`
`;

/** Bundles trusted commands only; never reads local API inputs or executes candidates. */
export async function buildOfflineKit() {
  const files = new Map([...buildContractPages().files].map(([name, text]) => [name, Buffer.from(text)]));
  for (const name of KIT.COMMANDS) {
    const relative = `scripts/cagent/${name}.mjs`;
    const built = await Bun.build({ entrypoints: [path.join(KIT.ROOT, relative)], target: 'node', format: 'esm',
      sourcemap: 'none', minify: false, write: false });
    if (!built.success || built.outputs.length !== 1) throw new Error(KIT.ERROR.BUILD);
    const bytes = Buffer.from(await built.outputs[0].arrayBuffer());
    const imports = new Bun.Transpiler({ loader: 'js', target: 'node' }).scan(bytes.toString('utf8')).imports;
    if (imports.some((item) => !isBuiltin(item.path))) throw new Error(KIT.ERROR.BUILD);
    files.set(relative, bytes);
  }
  files.set('START-HERE.md', Buffer.from(starts(false) + commands));
  files.set('START-HERE.zh-CN.md', Buffer.from(starts(true) + commands));
  for (const [index, name] of KIT.LICENSES.entries()) files.set(`licenses/${index}.txt`, await fs.readFile(path.join(KIT.ROOT, name)));
  const records = [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, digest: hash(bytes) }));
  const manifest = agentArtifactManifestSchema.parse({ version: AGENT_ARTIFACT.VERSION,
    artifactDigest: agentArtifactDigest(records), files: records });
  return { files, manifest };
}

export async function runBundleKit(args, output) {
  const jsonMode = args.includes('--json');
  const fail = (error) => { output(jsonMode ? JSON.stringify({ ok: false, error }) : error); return 1; };
  let values;
  try {
    ({ values } = parseArgs({ args, options: { out: { type: 'string' }, json: { type: 'boolean' }, quiet: { type: 'boolean' } }, allowPositionals: false }));
    if (!values.out) return fail(KIT.ERROR.INVALID);
  } catch { return fail(KIT.ERROR.INVALID); }
  const root = path.resolve(values.out);
  try {
    const parent = path.dirname(root);
    const stat = await fs.lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(parent) !== parent) return fail(KIT.ERROR.BOUNDARY);
    try { await fs.lstat(root); return fail(KIT.ERROR.EXISTS); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } catch { return fail(KIT.ERROR.BOUNDARY); }
  let plan;
  try { plan = await buildOfflineKit(); }
  catch { return fail(KIT.ERROR.BUILD); }
  try { await fs.mkdir(root, { mode: 0o700 }); }
  catch (error) { return fail(error.code === 'EEXIST' ? KIT.ERROR.EXISTS : KIT.ERROR.BOUNDARY); }
  try {
    for (const [name, bytes] of plan.files) {
      const target = path.join(root, 'protected', name);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    }
    await fs.mkdir(path.join(root, 'control'), { mode: 0o700 });
    const pending = path.join(root, 'control/manifest.pending');
    await fs.writeFile(pending, json(plan.manifest), { flag: 'wx', mode: 0o600 });
    await fs.rename(pending, path.join(root, 'control/manifest.json'));
  } catch { return fail(KIT.ERROR.INCOMPLETE); }
  const report = { ok: true, files: plan.files.size, digest: plan.manifest.artifactDigest,
    commands: KIT.COMMANDS.length, activation: 'unavailable', node: '24.9.0', bun: '1.3.14' };
  output(jsonMode ? JSON.stringify(report) : `kit bundled files:${report.files} digest:${report.digest}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBundleKit(process.argv.slice(2), (line) => process.stdout.write(`${line}\n`));
}
