import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { personalIdentity, personalVersion } from '../packages/web/server/lib/personal-build.js';

const root = path.resolve(import.meta.dirname, '..');
const upstream = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const base = personalVersion(upstream);

for (const build of ['', '12.3']) {
  for (const debug of [false, true]) {
    test(`ACP version ${build || 'local'}${debug ? ' debug' : ''} is distinct and starts as a personal identity`, () => {
      const expected = `${base}-ACP.${build || 'local'}${debug ? '-DEBUG' : ''}`;
      const printed = execFileSync(process.execPath, ['scripts/build-personal.mjs', '--acp', '--version', ...(debug ? ['--debug'] : [])], {
        cwd: root, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, OPENCHAMBER_BUILD_NUMBER: build },
      }).trim();
      assert.equal(printed, expected);
      assert.deepEqual(personalIdentity(printed), { upstream, version: expected });
    });
  }
}

test('ACP identities reject malformed run numbers and suffixes', () => {
  for (const suffix of ['0.1', '1.0', '01.1', '1', 'local-extra', '1.2-extra']) {
    assert.throws(() => personalIdentity(`${base}-ACP.${suffix}`));
  }
});

test('ACP workflow restricts the branch, builds by default and publishes only on explicit dispatch', () => {
  const workflow = parse(fs.readFileSync(path.join(root, '.github/workflows/acp-portable.yml'), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['codex/acp-integration']);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.permissions.contents, 'read');
  assert.match(workflow.jobs.build.if, /CastleYu\/openchamber/);
  assert.match(workflow.jobs.build.if, /refs\/heads\/codex\/acp-integration/);
  assert.match(workflow.jobs.publish.if, /workflow_dispatch.*inputs.publish/);
  assert.match(workflow.jobs.publish.if, /refs\/heads\/codex\/acp-integration/);
  const steps = workflow.jobs.build.steps;
  assert(steps.some(step => step.run === 'node scripts/build-personal.mjs --acp'));
  assert(steps.find(step => step.with?.path)?.with.path.includes('dist/acp/'));
});
