import { describe, it, expect } from 'vitest';
import { describeQueueTarget } from './queue-target.js';

const identity = { generation: 'oc1', profile: 'oc1', endpoint: 'http://127.0.0.1:1000', epoch: 1 };
const connection = { version: 1, confirmed: true, mode: 'configured', exe: 'C:/opencode.exe' };
const input = { connection, identity, binary: 'C:/opencode.exe', directory: 'C:/repo' };
describe('durable configured target', () => {
  it('survives a managed runtime port and epoch change, but not profile or binary changes', () => {
    const target = describeQueueTarget(input);
    expect(describeQueueTarget({ ...input, identity: { ...identity, endpoint: 'http://127.0.0.1:2000', epoch: 7 } })).toBe(target);
    expect(describeQueueTarget({ ...input, identity: { ...identity, profile: 'legacy-1.2.27' } })).not.toBe(target);
    expect(describeQueueTarget({ ...input, binary: 'C:/other.exe' })).not.toBe(target);
    expect(describeQueueTarget({ ...input, directory: 'C:/other' })).not.toBe(target);
  });
  it('normalizes external endpoint input and excludes managed launch facts', () => {
    const external = { ...input, connection: { version: 1, confirmed: true, mode: 'external', endpoint: 'https://agent.test/' } };
    expect(describeQueueTarget(external)).toBe(describeQueueTarget({ ...external, connection: { ...external.connection, endpoint: 'https://agent.test' }, binary: 'different', directory: 'different' }));
    expect(describeQueueTarget(external)).not.toBe(describeQueueTarget({ ...external, connection: { ...external.connection, endpoint: 'https://other.test' } }));
  });
  it('rejects missing or unconfirmed selection rather than deriving an implicit target', () => {
    expect(() => describeQueueTarget({ ...input, connection: null })).toThrow();
    expect(() => describeQueueTarget({ ...input, connection: { ...connection, confirmed: false } })).toThrow();
  });
});
