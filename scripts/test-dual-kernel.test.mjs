import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runUiTests, UI_TEST_FILES } from './test-dual-kernel.mjs';

test('runs every selected UI contract file separately and reports all failures', () => {
  const calls = [];
  const failures = runUiTests({
    bun: 'bun-fixture',
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const file = args.at(-1);
      if (file === UI_TEST_FILES[1]) return { status: 1 };
      if (file === UI_TEST_FILES[2]) return { error: new Error('spawn failed') };
      return { status: 0 };
    },
  });

  assert.equal(calls.length, UI_TEST_FILES.length);
  assert.ok(calls.every(({ command, args, options }) => (
    command === 'bun-fixture' && args[0] === 'test' && options.stdio === 'inherit'
  )));
  assert.deepEqual(failures, [
    `${UI_TEST_FILES[1]}: exited with 1`,
    `${UI_TEST_FILES[2]}: spawn failed`,
  ]);
});
