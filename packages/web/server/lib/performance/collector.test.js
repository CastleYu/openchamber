import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector } from './collector.js';

const row = (pid, parent, memory, cpu = 0, birth = 'first') => ({ pid, parent, name: 'process', memory, cpu, birth });

test('sums descendants once, retains reparented children, rejects reused PIDs', async () => {
  let time = 10000;
  let rows = [row(1, 0, 10), row(2, 1, 20), row(3, 2, 30), row(4, 0, 999)];
  const collector = createCollector({ root: 1, cores: 2, now: () => time, read: async () => rows });
  const first = await collector.read();
  assert.equal(first.memory, 60);
  assert.equal(first.cpu, null);
  time += 5000;
  rows = [row(1, 0, 10, 1), row(2, 0, 20, 2), row(3, 2, 30, 3), row(4, 0, 999)];
  assert.equal((await collector.read()).cpu, 60);
  time += 5000;
  rows = [row(1, 0, 10, 2), row(2, 0, 999, 0, 'reused')];
  assert.equal((await collector.read()).memory, 10);
});

test('shares in-flight and recent samples; failure is not an empty snapshot', async () => {
  let count = 0;
  let time = 10000;
  let fail = false;
  const collector = createCollector({ root: 1, now: () => time, read: async () => {
    count += 1;
    if (fail) throw new Error('denied');
    return [row(1, 0, 10)];
  } });
  const [a, b] = await Promise.all([collector.read(), collector.read()]);
  assert.equal(a, b);
  await collector.read();
  assert.equal(count, 1);
  time += 5000;
  fail = true;
  await assert.rejects(collector.read(), /denied/);
  fail = false;
  assert.equal((await collector.read()).memory, 10);
});
