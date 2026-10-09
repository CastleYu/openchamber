import { describe, expect, it } from 'vitest';
import { readDescendantActivity } from './descendant-activity.js';

const makeKernel = (children, generation = 'oc2') => ({
  captureIdentity: () => ({ generation, endpoint: 'local', epoch: 1 }),
  listChildren: async ({ sessionID }) => ({ data: children.get(sessionID) ?? [] }),
});

describe('descendant live activity', () => {
  it('keeps an idle parent busy through a nested child and settles after its status disappears', async () => {
    const kernel = makeKernel(new Map([
      ['parent', [{ id: 'child' }]], ['child', [{ id: 'grandchild' }]],
    ]));
    expect(await readDescendantActivity(kernel, 'parent', '/repo', { grandchild: { type: 'busy' } })).toBe(true);
    expect(await readDescendantActivity(kernel, 'parent', '/repo', {})).toBe(false);
  });

  it('preserves unknown after a failed child read and rejects a changed epoch', async () => {
    const failed = makeKernel(new Map());
    failed.listChildren = async () => { throw new Error('unavailable'); };
    expect(await readDescendantActivity(failed, 'parent', '/repo', {})).toBeNull();
    const changed = makeKernel(new Map([['parent', []]]));
    let epoch = 0;
    changed.captureIdentity = () => ({ generation: 'oc2', endpoint: 'local', epoch: epoch++ });
    expect(await readDescendantActivity(changed, 'parent', '/repo', {})).toBeNull();
  });

  it('rejects a profile switch during a child read even at the same epoch', async () => {
    let profile = 'oc2';
    let reads = 0;
    const kernel = makeKernel(new Map());
    kernel.captureIdentity = () => ({ generation: 'oc2', profile, endpoint: 'local', epoch: 1 });
    kernel.listChildren = async () => {
      reads++;
      profile = 'legacy-1.2.27';
      return { data: [{ id: 'child' }] };
    };
    expect(await readDescendantActivity(kernel, 'parent', '/repo', { child: { type: 'busy' } })).toBeNull();
    expect(reads).toBe(1);
  });

  it('leaves OC1 status behavior unchanged', async () => {
    const kernel = makeKernel(new Map(), 'oc1');
    kernel.listChildren = async () => { throw new Error('must not read'); };
    expect(await readDescendantActivity(kernel, 'parent', '/repo', {})).toBe(false);
  });
});
