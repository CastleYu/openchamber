import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBunExecutable } from './lib/bun-executable.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const UI_TEST_FILES = Object.freeze([
  'packages/ui/src/lib/opencode/client.protocol.test.ts',
  'packages/ui/src/lib/opencode/client.facade.test.ts',
  'packages/ui/src/lib/opencode/runtime.test.ts',
  'packages/ui/src/lib/opencode/events.test.ts',
  'packages/ui/src/lib/opencode/v1/sessions.test.ts',
  'packages/ui/src/lib/opencode/v1/projection.test.ts',
  'packages/ui/src/lib/opencode/v2/sessions.test.ts',
  'packages/ui/src/sync/source.test.ts',
  'packages/ui/src/sync/bootstrap.test.ts',
  'packages/ui/src/sync/domain-event-reducer.test.ts',
  'packages/ui/src/sync/domain-batch-authority.test.ts',
  'packages/ui/src/sync/event-pipeline-domain.test.ts',
  'packages/ui/src/lib/guests/load-catalog.test.ts',
  'packages/ui/src/stores/catalogRefresh.test.ts',
]);

export const runUiTests = ({
  bun = resolveBunExecutable(),
  spawn = spawnSync,
} = {}) => {
  const failures = [];

  for (const file of UI_TEST_FILES) {
    let result;
    try {
      result = spawn(bun, ['test', file], {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
      });
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    if (result.error) {
      failures.push(`${file}: ${result.error.message}`);
    } else if (result.status !== 0) {
      failures.push(`${file}: exited with ${result.status ?? result.signal ?? 'unknown status'}`);
    }
  }

  return failures;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runUiTests();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[dual-kernel-ui] ${failure}`);
    process.exitCode = 1;
  }
}
