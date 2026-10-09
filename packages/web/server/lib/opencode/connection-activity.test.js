import { describe, expect, it } from 'vitest';
import { createConnectionActivity } from './connection-activity.js';

const fixture = (generation = 'oc2') => {
  let identity = { generation, endpoint: 'http://fixture', epoch: 1 };
  let state = { ready: true, transitioning: false };
  let snapshot = { revision: 1, sessions: [{ directory: 'C:/one', items: [{ text: 'private' }], sendingId: 'sending' }] };
  let loaded = false;
  const calls = [];
  const read = name => async ({ directory, signal }) => {
    calls.push({ name, directory, signal });
    return { ...identity, data: name === 'busy' ? { ses: { type: 'busy' }, idle: { type: 'idle' } } : [{ id: name, sessionID: 'ses', text: 'private' }] };
  };
  const kernelOperations = { captureIdentity: () => identity, listActiveStatuses: read('busy'), listPendingPermissions: read('permission'), listPendingQuestions: read('question') };
  const queue = { load: async () => { loaded = true; }, snapshot: () => { expect(loaded).toBe(true); return snapshot; } };
  const activity = createConnectionActivity({ kernelOperations, queue, getDirectories: async () => ['C:/one', 'C:/two', 'C:/one'], getState: () => state });
  return { activity, kernelOperations, queue, calls, retire: () => { identity = { ...identity, epoch: 2 }; }, transition: () => { state = { ready: true, transitioning: true }; }, cold: () => { state = { ready: false, transitioning: false }; }, mutateQueue: () => { snapshot = { ...snapshot, revision: 2 }; } };
};

describe('connection activity evidence', () => {
  it.each(['oc1', 'oc2'])('reports %s scoped counts and removes sensitive payloads', async generation => {
    const f = fixture(generation);
    const result = await f.activity.inspect();
    expect(result).toEqual({ state: 'active', scope: { coverage: 'configured-directories', busy: generation === 'oc2' ? 'global' : 'configured-directories', directories: ['C:/one', 'C:/two'] },
      busy: { state: 'known', count: 1 }, permissions: { state: 'known', count: 1 }, questions: { state: 'known', count: 1 },
      queue: { state: 'known', count: 1, sending: 1, revision: 1 }, clients: { state: 'unknown', observedCount: 0 } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('http://fixture');
    expect(f.calls.filter(call => call.name === 'busy')).toHaveLength(generation === 'oc1' ? 2 : 1);
    expect(f.calls.every(call => call.signal instanceof AbortSignal)).toBe(true);
  });
  it('keeps successful scopes and other categories when one read fails', async () => {
    const f = fixture();
    f.kernelOperations.listPendingQuestions = async ({ directory }) => {
      if (directory === 'C:/two') throw new Error('private');
      return { ...f.kernelOperations.captureIdentity(), data: [{ id: 'q', sessionID: 's' }] };
    };
    const result = await f.activity.inspect();
    expect(result.questions).toEqual({ state: 'unknown', observedCount: 1 });
    expect(result.permissions).toEqual({ state: 'known', count: 1 });
  });
  it('rejects a changed owner instead of combining snapshots', async () => {
    const f = fixture();
    f.kernelOperations.listPendingQuestions = async () => { const old = f.kernelOperations.captureIdentity(); f.retire(); return { ...old, data: [] }; };
    await expect(f.activity.inspect()).rejects.toMatchObject({ status: 409 });
  });
  it.each(['transition', 'mutateQueue'])('rejects %s during inspection', async action => {
    const f = fixture();
    f.kernelOperations.listPendingQuestions = async () => { f[action](); return { ...f.kernelOperations.captureIdentity(), data: [] }; };
    await expect(f.activity.inspect()).rejects.toMatchObject({ status: 409 });
  });
  it.each(['cold', 'transition'])('never treats %s upstream as empty or dispatches requests', async action => {
    const f = fixture(); f[action]();
    const result = await f.activity.inspect();
    expect(result.busy.state).toBe('unknown'); expect(result.permissions.state).toBe('unknown'); expect(result.questions.state).toBe('unknown');
    expect(f.calls).toEqual([]);
  });
  it('fails an authoritative queue read without emitting an empty report', async () => {
    const f = fixture(); f.queue.load = async () => { throw new Error('queue unavailable'); };
    await expect(f.activity.inspect()).rejects.toThrow('queue unavailable');
  });
});

it('rejects retirement even when the new kernel cannot admit an identity', async () => {
  const f = fixture();
  f.kernelOperations.listPendingQuestions = async () => {
    const identity = f.kernelOperations.captureIdentity();
    f.kernelOperations.captureIdentity = () => { throw new Error('not ready'); };
    return { ...identity, data: [] };
  };
  await expect(f.activity.inspect()).rejects.toMatchObject({ status: 409 });
});
it('keeps missing directory coverage distinct from an authoritative global empty status', async () => {
  const identity = { generation: 'oc2', endpoint: 'http://fixture', epoch: 1 };
  const pending = () => { throw new Error('must not read an invented directory'); };
  const activity = createConnectionActivity({
    kernelOperations: { captureIdentity: () => identity, listActiveStatuses: async () => ({ ...identity, data: {} }), listPendingPermissions: pending, listPendingQuestions: pending },
    queue: { load: async () => {}, snapshot: () => ({ revision: 0, sessions: [] }) },
    getDirectories: async () => [], getState: () => ({ ready: true, transitioning: false }),
  });
  const result = await activity.inspect();
  expect(result.busy).toEqual({ state: 'known', count: 0 });
  expect(result.permissions).toEqual({ state: 'unknown', observedCount: 0 });
  expect(result.questions).toEqual({ state: 'unknown', observedCount: 0 });
});

describe('confirmed external interruption', () => {
  it.each(['oc1','oc2'])('interrupts busy %s sessions in their scope and verifies idle again', async generation => {
    const f=fixture(generation);const stopped=new Set();const interrupted=[];
    f.kernelOperations.listActiveStatuses=async ({directory,signal})=>{
      expect(signal).toBeInstanceOf(AbortSignal);
      return {...f.kernelOperations.captureIdentity(),data:stopped.has(directory)?{ses:{type:'idle'}}:{ses:{type:'busy'},idle:{type:'idle'}}};
    };
    f.kernelOperations.interruptSession=async ({sessionID,directory,signal})=>{expect(signal).toBeInstanceOf(AbortSignal);interrupted.push({sessionID,directory});stopped.add(directory);};
    await f.activity.stop({scope:{busy:generation==='oc2'?'global':'configured-directories',directories:['C:/one','C:/two']}});
    expect(interrupted).toEqual(generation==='oc2'?[{sessionID:'ses',directory:undefined}]:[{sessionID:'ses',directory:'C:/one'},{sessionID:'ses',directory:'C:/two'}]);
  });
  it('does not treat accepted interruption as authoritative idle',async()=>{
    const f=fixture();f.kernelOperations.interruptSession=async()=>{};
    await expect(f.activity.stop({scope:{busy:'global',directories:[]}})).rejects.toMatchObject({status:409});
  });
  it('rejects an old status result before interrupting another owner',async()=>{
    const f=fixture();let interrupted=false;
    f.kernelOperations.listActiveStatuses=async()=>{const old=f.kernelOperations.captureIdentity();f.retire();return {...old,data:{ses:{type:'busy'}}};};
    f.kernelOperations.interruptSession=async()=>{interrupted=true;};
    await expect(f.activity.stop({scope:{busy:'global',directories:[]}})).rejects.toMatchObject({status:409});
    expect(interrupted).toBe(false);
  });
  it('preserves authoritative read failures without issuing interruption',async()=>{
    const f=fixture();let interrupted=false;
    f.kernelOperations.listActiveStatuses=async()=>{throw new Error('status unavailable');};
    f.kernelOperations.interruptSession=async()=>{interrupted=true;};
    await expect(f.activity.stop({scope:{busy:'global',directories:[]}})).rejects.toThrow('status unavailable');expect(interrupted).toBe(false);
  });
});

it('reports unowned client queues as unknown without discarding upstream evidence', async () => {
  const f = fixture();
  const activity = createConnectionActivity({
    kernelOperations: f.kernelOperations, queue: null,
    getDirectories: async () => ['C:/one'],
    getState: () => ({ ready: true, transitioning: false }),
  });
  const result = await activity.inspect();
  expect(result.queue).toEqual({ state: 'unknown', observedCount: 0 });
  expect(result.busy).toEqual({ state: 'known', count: 1 });
  expect(result.scope.directories).toEqual(['C:/one']);
});
