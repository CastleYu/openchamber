import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnOwnedProcess } from './owned-process';

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const waitFor = async (promise: Promise<unknown>, message: string, timeoutMs = 3000) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

test('Windows owned termination batches live targets and leaves other owners running', {
  skip: process.platform !== 'win32',
  timeout: 20_000,
}, async () => {
  const start = () => {
    const owned = spawnOwnedProcess(process.execPath, ['-e', "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);"], {
      cwd: process.cwd(), env: process.env,
    });
    const ready = new Promise<void>((resolve, reject) => {
      owned.child.stdout?.once('data', () => resolve());
      owned.child.once('error', reject);
    });
    return { ...owned, ready };
  };

  const first = start();
  const second = start();
  const sentinel = start();
  const natural = spawnOwnedProcess(process.execPath, ['-e', "process.stdout.write('ready\\n'); setTimeout(() => process.exit(0), 100);"], {
    cwd: process.cwd(), env: process.env,
  });
  const naturalReady = new Promise<void>((resolve, reject) => {
    natural.child.stdout?.once('data', () => resolve());
    natural.child.once('error', reject);
  });
  const fixtures = [first, second, sentinel, { ...natural, ready: naturalReady }];

  let primary: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    await Promise.all(fixtures.map(fixture => waitFor(fixture.ready, 'Owned process did not become ready')));
    const pids = fixtures.map(fixture => fixture.child.pid);
    assert.ok(pids.every((pid): pid is number => pid !== undefined));
    assert.ok([first, second, sentinel].every(fixture => fixture.child.pid && alive(fixture.child.pid)), 'long-running fixtures must be alive');

    await waitFor(natural.closed, 'Natural-exit fixture did not close');
    assert.equal(alive(natural.child.pid!), false, 'natural-exit fixture must already be gone');

    const firstTermination = first.terminate();
    assert.strictEqual(first.terminate(), firstTermination, 'duplicate termination must share its promise');
    const secondTermination = second.terminate();
    await waitFor(Promise.all([firstTermination, secondTermination, natural.terminate()]), 'Concurrent owned termination timed out', 6500);

    assert.equal(alive(first.child.pid!), false);
    assert.equal(alive(second.child.pid!), false);
    assert.equal(alive(sentinel.child.pid!), true, 'an unrelated live owner must remain untouched');
  } catch (error) {
    primary = error;
  } finally {
    const cleanup = await Promise.allSettled(fixtures.map(fixture => fixture.terminate()));
    const closeErrors: Error[] = [];
    for (const fixture of fixtures) {
      if (fixture.child.pid && alive(fixture.child.pid)) fixture.child.kill();
      try {
        await waitFor(fixture.closed, 'Fixture cleanup did not close every owned child');
      } catch (error) {
        closeErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    const remaining = fixtures.flatMap(fixture => fixture.child.pid && alive(fixture.child.pid) ? [fixture.child.pid] : []);
    if (remaining.length) closeErrors.push(new Error('Exact fixture children remain alive: ' + remaining.join(', ')));
    const failed = cleanup.filter(result => result.status === 'rejected');
    if (failed.length || closeErrors.length) {
      cleanupErrors.push(...failed.map(result => result.reason), ...closeErrors);
    }
  }
  if (cleanupErrors.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors], 'Owned fixture cleanup failed');
  if (primary) throw primary;
});
