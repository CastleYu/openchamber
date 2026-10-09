import { createFixtureChecks } from './fixture-checks.mjs';
import { fixtureTaskSchema, PROCESS } from './fixture-process.mjs';
import { z } from 'zod';

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
      const adapter = await namespace.createAdapter(context);
      return adapter.handlers[task.definition.operation];
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
