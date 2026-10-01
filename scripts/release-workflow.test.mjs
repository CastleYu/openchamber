import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const workflowPath = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));
const workflow = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));

test('manifests combine after partial build failures while publication stays strict', () => {
  assert.equal(
    workflow.jobs['combine-electron-manifests'].if,
    "${{ !cancelled() && needs.create-release.result == 'success' }}",
  );
  // Skipped jobs count as done; any failure still stops the release.
  assert.equal(workflow.jobs['finalize-release'].if, "${{ !cancelled() && !failure() }}");
});

test('finishing a published release selects macOS and iOS without rebuilding other platforms', () => {
  const input = workflow.on.workflow_dispatch.inputs.finish_published_release;
  assert.equal(input.default, false);
  assert.equal(workflow.jobs['create-release'].steps.find((step) => step.id === 'create_release').with.draft,
    "${{ github.event.inputs.finish_published_release != 'true' }}");
  for (const job of ['publish-npm', 'build-desktop-electron-windows', 'build-desktop-electron-linux']) {
    assert.equal(workflow.jobs[job].if, "${{ github.event.inputs.finish_published_release != 'true' }}");
  }
  assert.equal(workflow.jobs['combine-electron-manifests'].steps.find((step) => step.name === 'Finalize combined manifests').env.MAC_ONLY,
    "${{ github.event.inputs.finish_published_release == 'true' && '1' || '' }}");
  assert.equal(workflow.jobs['mobile-release'].with.build_android,
    "${{ github.event.inputs.finish_published_release != 'true' }}");
});
