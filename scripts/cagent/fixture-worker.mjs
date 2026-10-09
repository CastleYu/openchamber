import { createFixtureChecks } from './fixture-checks.mjs';
import { fixtureTaskSchema, PROCESS } from './fixture-process.mjs';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { agentAdapterSchema } from '../../packages/web/server/lib/agent/schemas.js';
import { extensionManifestSchema } from '../../packages/web/server/lib/agent/extensions.js';

const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > PROCESS.MAX_INPUT) process.exit(2);
  chunks.push(chunk);
}
try {
  const task = fixtureTaskSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
  if (!process.permission || process.permission.has('fs.write') || process.permission.has('child') || process.permission.has('worker')) process.exit(2);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(task.source).toString('base64')}`;
  const checks = createFixtureChecks(task.definition, async () => {
    const namespace = z.object({ createAdapter: z.function() }).strict().parse(await import(moduleUrl));
    return async (context) => {
      const candidate = await namespace.createAdapter(context);
      if ('operation' in task.definition) return candidate.handlers[task.definition.operation];
      const adapter = agentAdapterSchema.parse(candidate);
      const manifest = extensionManifestSchema.parse(task.definition.manifest);
      const matches = (adapter.extensions ?? []).filter((item) => item.manifest.actionID === task.definition.actionID
        && isDeepStrictEqual(extensionManifestSchema.parse(item.manifest), manifest));
      if (matches.length !== 1) return null;
      return matches[0].handler;
    };
  });
  process.stdout.write(`${JSON.stringify({ ready: true })}\n`);
  const results = [];
  for (const check of checks) results.push({ id: check.id, passed: await check.run([]) });
  process.stdout.write(`${JSON.stringify({ checks: results })}\n`);
} catch {
  process.stderr.write('fixture worker failed');
  process.exitCode = 1;
}
