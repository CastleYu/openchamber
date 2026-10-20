import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMessageQueueRuntime } from './runtime.js';

const SESSION = 'ses_attempt_test_1';
const OTHER = 'ses_attempt_test_2';
const DIRECTORY = '/repo';
const TARGET = 'a'.repeat(64);
const IDENTITY = { generation: 'oc1', profile: 'legacy-1.2.27', version: '1.2.27', endpoint: 'http://legacy.test', epoch: 1 };
const mkItem = (content = 'queued') => ({ content, text: content, attachments: [], sendConfig: { providerID: 'anthropic', modelID: 'claude' } });
const dirs = [];
const dataDir = () => { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-int05-attempt-')); dirs.push(value); return value; };
const runtimes = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) { runtime.stop(); await runtime.flush(); }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const runtimeFor = ({ dir = dataDir(), sendPrompt = vi.fn(async () => ({ accepted: true })), getQueueTarget = async () => TARGET, identity = IDENTITY, listCommands = async () => ({ data: [] }), listMessages = async () => ({ data: { order: 'desc', items: [] } }), getMessage = async () => ({ data: null }) } = {}) => {
  let event = () => {};
  const statuses = {};
  const kernelOperations = {
    captureIdentity: () => identity,
    listActiveStatuses: async () => ({ data: statuses }),
    listMessages,
    getMessage,
    listChildren: async () => ({ data: [] }),
    listCommands,
    sendPrompt,
    sendCommand: sendPrompt,
  };
  const runtime = createMessageQueueRuntime({
    globalEventHub: { subscribeEvent(handler) { event = handler; return () => {}; }, subscribeStatus() { return () => {}; } },
    kernelOperations, getQueueTarget, dataDir: dir, dispatchQuietMs: 0, retryDelayMs: () => 10,
  });
  runtimes.push(runtime);
  return { runtime, dir, sendPrompt, statuses, idle: (sessionId = SESSION) => event({ payload: { type: 'session.status', properties: { sessionID: sessionId, status: { type: 'idle' } } }, directory: DIRECTORY }) };
};
const settle = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const persisted = dir => JSON.parse(fs.readFileSync(path.join(dir, 'message-queue.json'), 'utf8'));
const enqueueBusy = async (h, sessionId = SESSION, content = 'queued') => {
  h.statuses[sessionId] = { type: 'busy' };
  const result = await h.runtime.enqueue(sessionId, DIRECTORY, mkItem(content));
  await h.runtime.flush();
  return result.itemId;
};

describe('durable legacy send attempts', () => {
  it('persists pending before mutation and keeps accepted without claiming completion', async () => {
    let dir;
    const sendPrompt = vi.fn(async () => {
      const item = persisted(dir).sessions[SESSION].items[0];
      expect(item.attempt).toMatchObject({ state: 'pending', id: expect.any(String), createdAt: expect.any(Number) });
      h.statuses[SESSION] = { type: 'busy' };
      return { accepted: true };
    });
    const h = runtimeFor({ sendPrompt }); dir = h.dir;
    h.runtime.start();
    const first = await enqueueBusy(h);
    const second = await h.runtime.enqueue(SESSION, DIRECTORY, mkItem('second'));
    h.statuses[SESSION] = {};
    h.idle();
    await settle();
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(h.runtime.sessionSnapshot(SESSION).items[0]).toMatchObject({ id: first, attempt: { state: 'accepted' } });
    expect(h.runtime.sessionSnapshot(SESSION).items[0].attempt).not.toHaveProperty('completedAt');
    expect(h.runtime.sessionSnapshot(SESSION).items[1]).toMatchObject({ id: second.itemId });
    expect(h.runtime.sessionSnapshot(SESSION).items[1]).not.toHaveProperty('attempt');
  });

  it('sends its durable message ID and keeps that private ID out of the public projection', async () => {
    let dir;
    const sendPrompt = vi.fn(async body => {
      const stored = persisted(dir).sessions[SESSION].items[0];
      expect(stored.attempt.messageID).toBe(body.request.body.messageID);
      expect(body.request.body.messageID).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
      return { accepted: true };
    });
    const h = runtimeFor({ sendPrompt }); dir = h.dir;
    h.runtime.start();
    const id = await enqueueBusy(h);
    h.statuses[SESSION] = {}; h.idle();
    await settle();
    const item = h.runtime.sessionSnapshot(SESSION).items.find(entry => entry.id === id);
    expect(item.attempt).not.toHaveProperty('messageID');
    expect(persisted(dir).sessions[SESSION].items[0].attempt.messageID).toBeTruthy();
  });

  it('reconciles a completed assistant reply to completed after a successful send', async () => {
    let messageID;
    const h = runtimeFor({
      sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; return { accepted: true }; }),
      listMessages: async () => ({ data: { order: 'desc', items: messageID ? [{ id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: messageID, completed: Date.now() }] : [] } }),
      getMessage: async args => ({ data: { info: { id: args.messageID, sessionID: SESSION, role: 'assistant', parentID: messageID, time: { completed: Date.now() }, finish: 'stop' } } }),
    });
    h.runtime.start(); await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle();
    await expect.poll(() => h.sendPrompt.mock.calls.length, { timeout: 3000 }).toBe(1);
    h.statuses[SESSION] = {}; h.idle(); await settle(100);
    await expect.poll(() => h.runtime.sessionSnapshot(SESSION).items[0]?.attempt.state, { timeout: 3000 }).toBe('completed');
    expect(h.runtime.sessionSnapshot(SESSION).items[0].attempt).not.toHaveProperty('messageID');
  });

  it('skips a completed tool reply before the final matching assistant', async () => {
    let messageID;
    const h = runtimeFor({
      sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; return { accepted: true }; }),
      listMessages: async () => ({ data: { order: 'desc', items: messageID ? [
        { id: 'msg_tool', role: 'assistant', parentID: messageID, completed: Date.now(), finish: 'tool-calls' },
        { id: 'msg_final', role: 'assistant', parentID: messageID, completed: Date.now(), finish: 'stop' },
      ] : [] } }),
      getMessage: vi.fn(async args => ({ data: { info: { id: args.messageID, sessionID: SESSION, role: 'assistant', parentID: messageID, time: { completed: Date.now() }, finish: args.messageID === 'msg_final' ? 'stop' : 'tool-calls' } } })),
    });
    h.runtime.start(); await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle();
    await expect.poll(() => h.runtime.sessionSnapshot(SESSION).items[0]?.attempt?.state).toBe('completed');
    expect(h.sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('marks a matching aborted reply failed after a lost response', async () => {
    let messageID;
    const h = runtimeFor({
      sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; throw new Error('response lost'); }),
      listMessages: async () => ({ data: { order: 'desc', items: [{ id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: messageID, completed: Date.now() }] } }),
      getMessage: async args => ({ data: { info: { id: args.messageID, sessionID: SESSION, role: 'assistant', parentID: messageID, time: { completed: Date.now() }, finish: 'stop', error: { name: 'MessageAbortedError' } } } }),
    });
    h.runtime.start(); const id = await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle(); await settle(80); h.idle(); await settle(100);
    await expect.poll(() => h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id)?.attempt.state, { timeout: 3000 }).toBe('failed');
    expect(h.sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('leaves an intermediate tool-calls reply unresolved', async () => {
    let messageID;
    const h = runtimeFor({
      sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; throw new Error('response lost'); }),
      listMessages: async () => ({ data: { order: 'desc', items: [{ id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: messageID, completed: Date.now() }] } }),
      getMessage: async args => ({ data: { info: { id: args.messageID, sessionID: SESSION, role: 'assistant', parentID: messageID, time: { completed: Date.now() }, finish: 'tool-calls' } } }),
    });
    h.runtime.start(); const id = await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle(); await settle(80); h.idle(); await settle(100);
    expect(h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id).attempt.state).toBe('unknown');
  });

  it('keeps unmatched, busy, malformed and failed terminal reads unchanged', async () => {
    const cases = [
      { name: 'unrelated parent', items: [{ id: 'msg_other', sessionID: SESSION, role: 'assistant', parentID: 'msg_other_user', completed: Date.now() }], reply: { id: 'msg_other', sessionID: SESSION, role: 'assistant', parentID: 'msg_other_user', time: { completed: Date.now() }, finish: 'stop' } },
      { name: 'missing completion', items: [{ id: 'msg_candidate', sessionID: SESSION, role: 'assistant', parentID: 'msg_user', completed: Date.now() }], reply: { id: 'msg_candidate', sessionID: SESSION, role: 'assistant', parentID: 'msg_user', finish: 'stop' } },
    ];
    for (const entry of cases) {
      let messageID;
      const h = runtimeFor({ sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; throw new Error('response lost'); }), listMessages: async () => ({ data: { order: 'desc', items: entry.items.map(item => ({ ...item, parentID: entry.name === 'missing completion' ? messageID : item.parentID })) } }), getMessage: async () => ({ data: { info: { ...entry.reply, parentID: entry.name === 'missing completion' ? messageID : entry.reply.parentID } } }) });
      h.runtime.start(); const id = await enqueueBusy(h, SESSION, entry.name); h.statuses[SESSION] = {}; h.idle(); await settle(80); h.idle(); await settle(80);
      expect(h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id).attempt.state).toBe('unknown');
      expect(h.sendPrompt).toHaveBeenCalledTimes(1);
    }
  });

  it('does not reconcile while send is pending, then resolves a lost response without replay', async () => {
    let releaseSend;
    let messageID;
    const h = runtimeFor({
      sendPrompt: vi.fn(body => { messageID = body.request.body.messageID; return new Promise((_, reject) => { releaseSend = () => reject(new Error('response lost')); }); }),
      listMessages: async () => ({ data: { order: 'desc', items: [{ id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: messageID, completed: Date.now() }] } }),
      getMessage: async args => ({ data: { info: { id: args.messageID, sessionID: SESSION, role: 'assistant', parentID: messageID, time: { completed: Date.now() }, finish: 'stop' } } }),
    });
    h.runtime.start(); const id = await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle(); await settle(80);
    expect(h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id).attempt.state).toBe('pending');
    releaseSend(); await settle(80); h.idle();
    await expect.poll(() => h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id)?.attempt.state, { timeout: 3000 }).toBe('completed');
    expect(h.sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown when terminal persistence fails', async () => {
    let messageID;
    let dir;
    const h = runtimeFor({
      sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; throw new Error('response lost'); }),
      listMessages: async () => ({ data: { order: 'desc', items: [{ id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: messageID, completed: Date.now() }] } }),
      getMessage: async args => {
        const file = path.join(dir, 'message-queue.json');
        fs.unlinkSync(file); fs.mkdirSync(file);
        return { data: { info: { id: args.messageID, sessionID: SESSION, role: 'assistant', parentID: messageID, time: { completed: Date.now() }, finish: 'stop' } } };
      },
    });
    dir = h.dir;
    h.runtime.start(); const id = await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle(); await settle(80); h.idle(); await settle(100);
    expect(h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id).attempt.state).toBe('unknown');
    expect(h.sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('does not read terminals while busy or turn read failures into outcomes', async () => {
    const busyGetMessage = vi.fn();
    const busy = runtimeFor({ sendPrompt: vi.fn(async () => { throw new Error('response lost'); }), getMessage: busyGetMessage });
    busy.runtime.start(); const busyId = await enqueueBusy(busy); busy.statuses[SESSION] = {}; busy.idle(); await settle(80);
    busy.statuses[SESSION] = { type: 'busy' }; busy.idle(); await settle(80);
    expect(busy.runtime.sessionSnapshot(SESSION).items.find(item => item.id === busyId).attempt.state).toBe('unknown');
    expect(busyGetMessage).not.toHaveBeenCalled();

    let messageID;
    const failedRead = vi.fn(async () => { throw new Error('terminal read failed'); });
    const h = runtimeFor({
      sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; throw new Error('response lost'); }),
      listMessages: async () => ({ data: { order: 'desc', items: [{ id: 'msg_candidate', sessionID: SESSION, role: 'assistant', parentID: messageID, completed: Date.now() }] } }),
      getMessage: failedRead,
    });
    h.runtime.start(); const id = await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle(); await settle(80); h.idle(); await settle(80);
    expect(h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id).attempt.state).toBe('unknown');
    expect(h.sendPrompt).toHaveBeenCalledTimes(1);
    expect(failedRead).toHaveBeenCalled();
  });

  it('ignores a terminal result that returns after runtime retirement', async () => {
    let messageID;
    let releaseRead;
    let enteredRead;
    const readEntered = new Promise(resolve => { enteredRead = resolve; });
    const h = runtimeFor({
      sendPrompt: vi.fn(async body => { messageID = body.request.body.messageID; throw new Error('response lost'); }),
      listMessages: async () => ({ data: { order: 'desc', items: [{ id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: messageID, completed: Date.now() }] } }),
      getMessage: () => { enteredRead(); return new Promise(resolve => { releaseRead = resolve; }); },
    });
    h.runtime.start(); const id = await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle(); await settle(80); h.idle();
    await readEntered;
    h.runtime.stop();
    releaseRead({ data: { info: { id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: messageID, time: { completed: Date.now() }, finish: 'stop' } } });
    await settle(80);
    expect(h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id).attempt.state).toBe('unknown');
  });

  it('does not let an older terminal read overwrite a replacement attempt', async () => {
    let oldMessageID;
    let sends = 0;
    let releaseRead;
    let enteredRead;
    const readEntered = new Promise(resolve => { enteredRead = resolve; });
    const h = runtimeFor({
      sendPrompt: vi.fn(async () => {
        sends += 1;
        if (sends === 1) throw new Error('first response lost');
        return { accepted: true };
      }),
      listMessages: async () => ({ data: { order: 'desc', items: oldMessageID ? [{ id: 'msg_assistant', sessionID: SESSION, role: 'assistant', parentID: oldMessageID, completed: Date.now() }] : [] } }),
      getMessage: args => { enteredRead(); return new Promise(resolve => { releaseRead = () => resolve({ data: { info: { id: args.messageID, sessionID: SESSION, role: 'assistant', parentID: oldMessageID, time: { completed: Date.now() }, finish: 'stop' } } }); }); },
    });
    h.runtime.start(); const id = await enqueueBusy(h); h.statuses[SESSION] = {}; h.idle();
    await expect.poll(() => persisted(h.dir).sessions[SESSION].items[0]?.attempt?.state, { timeout: 3000 }).toBe('unknown');
    oldMessageID = persisted(h.dir).sessions[SESSION].items[0].attempt.messageID;
    const oldAttemptId = persisted(h.dir).sessions[SESSION].items[0].attempt.id;
    h.idle(); await readEntered;
    await h.runtime.resubmit(SESSION, id, { attemptId: oldAttemptId, confirmed: true });
    const replacement = persisted(h.dir).sessions[SESSION].items[0].attempt;
    expect(replacement.state).toBe('accepted');
    expect(replacement.id).not.toBe(oldAttemptId);
    releaseRead(); await settle(80);
    expect(persisted(h.dir).sessions[SESSION].items[0].attempt).toMatchObject({ id: replacement.id, state: 'accepted', messageID: replacement.messageID });
    expect(h.sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('marks a lost response unknown without replay and still dispatches another session', async () => {
    const sendPrompt = vi.fn(async ({ sessionID }) => {
      if (sessionID === SESSION) throw new Error('response lost after acceptance');
      return { accepted: true };
    });
    const h = runtimeFor({ sendPrompt }); h.runtime.start();
    const id = await enqueueBusy(h);
    await enqueueBusy(h, OTHER, 'independent');
    h.statuses[SESSION] = {}; h.statuses[OTHER] = {};
    h.idle(); h.idle(OTHER);
    await settle(120);
    const item = h.runtime.sessionSnapshot(SESSION).items.find(entry => entry.id === id);
    expect(item.attempt.state).toBe('unknown');
    expect(sendPrompt.mock.calls.filter(([arg]) => arg.sessionID === SESSION)).toHaveLength(1);
    await expect.poll(() => sendPrompt.mock.calls.filter(([arg]) => arg.sessionID === OTHER).length, { timeout: 3000 }).toBe(1);
  });

  it.each(['pending', 'accepted'])('restores persisted %s attempt as unknown', async state => {
    const dir = dataDir();
    fs.writeFileSync(path.join(dir, 'message-queue.json'), JSON.stringify({ version: 1, revision: 1, sessions: {
      [SESSION]: { directory: DIRECTORY, items: [{ id: 'restored', createdAt: 1, ...mkItem(), target: TARGET, attempt: { id: 'old-attempt', state, createdAt: 2 } }] },
    } }));
    const h = runtimeFor({ dir });
    await h.runtime.load();
    expect(h.runtime.sessionSnapshot(SESSION).items[0]).toMatchObject({ id: 'restored', attempt: { id: 'old-attempt', state: 'unknown' } });
  });

  it('admits only one concurrent explicit resubmission for the exact unknown attempt', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const sendPrompt = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('uncertain first result');
      return pending;
    });
    const h = runtimeFor({ sendPrompt }); h.runtime.start();
    const id = await enqueueBusy(h);
    h.statuses[SESSION] = {}; h.idle();
    await settle();
    const attemptId = h.runtime.sessionSnapshot(SESSION).items[0].attempt.id;
    h.runtime.stop();
    const recovered = runtimeFor({ dir: h.dir, sendPrompt });
    await recovered.runtime.load();
    await expect(recovered.runtime.resubmit(SESSION, id, { attemptId, confirmed: false })).rejects.toMatchObject({ status: 409 });
    await expect(recovered.runtime.resubmit(SESSION, id, { attemptId: 'old-id', confirmed: true })).rejects.toMatchObject({ status: 409 });
    const submissions = [
      recovered.runtime.resubmit(SESSION, id, { attemptId, confirmed: true }),
      recovered.runtime.resubmit(SESSION, id, { attemptId, confirmed: true }),
    ];
    await settle();
    expect(sendPrompt).toHaveBeenCalledTimes(2);
    release({ accepted: true });
    const results = await Promise.allSettled(submissions);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });

  it('does not create an attempt when slash-command preparation fails before mutation', async () => {
    const listCommands = vi.fn(async () => { throw new Error('command lookup failed'); });
    const sendPrompt = vi.fn();
    const h = runtimeFor({ listCommands, sendPrompt }); h.runtime.start();
    const id = await enqueueBusy(h, SESSION, '/review');
    h.statuses[SESSION] = {}; h.idle(); await settle();
    expect(listCommands).toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(h.runtime.sessionSnapshot(SESSION).items.find(item => item.id === id)).not.toHaveProperty('attempt');
  });

  it('blocks take, edit, batch, reorder, remove, and clear from bypassing unresolved attempts', async () => {
    const h = runtimeFor({ sendPrompt: vi.fn(async () => { throw new Error('uncertain'); }) });
    h.runtime.start();
    const id = await enqueueBusy(h);
    await h.runtime.enqueue(SESSION, DIRECTORY, mkItem('other'));
    h.statuses[SESSION] = {}; h.idle(); await settle();
    await expect(h.runtime.take(SESSION, id)).rejects.toMatchObject({ status: 409 });
    await expect(h.runtime.take(SESSION, id, 'edit')).rejects.toMatchObject({ status: 409 });
    const otherId = h.runtime.sessionSnapshot(SESSION).items.find(item => item.id !== id).id;
    await expect(h.runtime.take(SESSION, otherId)).rejects.toMatchObject({ status: 409 });
    await expect(h.runtime.take(SESSION, otherId, 'edit')).rejects.toMatchObject({ status: 409 });
    await expect(h.runtime.takeAll(SESSION)).rejects.toMatchObject({ status: 409 });
    await expect(h.runtime.takeAll(SESSION, 'edit')).rejects.toMatchObject({ status: 409 });
    await expect(h.runtime.reorder(SESSION, h.runtime.sessionSnapshot(SESSION).items.map(item => item.id).reverse())).rejects.toMatchObject({ status: 409 });
    await expect(h.runtime.remove(SESSION, id)).rejects.toMatchObject({ status: 409 });
    await h.runtime.clear(SESSION);
    expect(h.runtime.sessionSnapshot(SESSION).items.some(item => item.id === id && item.attempt.state === 'unknown')).toBe(true);
  });

  it.each(['oc1', 'oc2'])('keeps ordinary %s failure retry and success removal semantics', async generation => {
    let sends = 0;
    const sendPrompt = vi.fn(async () => {
      sends += 1;
      if (sends === 1) throw new Error('ordinary retryable failure');
      return { accepted: true };
    });
    const identity = { ...IDENTITY, generation, profile: generation };
    const h = runtimeFor({ sendPrompt, identity });
    h.runtime.start();
    const id = await enqueueBusy(h);
    h.statuses[SESSION] = {}; h.idle();
    await settle(100);
    expect(sendPrompt).toHaveBeenCalledTimes(2);
    expect(h.runtime.sessionSnapshot(SESSION).items).not.toContainEqual(expect.objectContaining({ id }));
  });

  it('does not dispatch after retirement during command preparation', async () => {
    let release;
    let entered;
    const prepared = new Promise(resolve => { entered = resolve; });
    const listCommands = () => { entered(); return new Promise(resolve => { release = resolve; }); };
    const h = runtimeFor({ listCommands }); h.runtime.start();
    await enqueueBusy(h, SESSION, '/review');
    h.statuses[SESSION] = {}; h.idle();
    await prepared;
    h.runtime.stop(); release({ data: [] });
    await settle();
    expect(h.sendPrompt).not.toHaveBeenCalled();
    expect(h.runtime.sessionSnapshot(SESSION).items[0]).not.toHaveProperty('attempt');
  });

  it.each(['attempt', 'payload'])('preserves the stored file when recorded %s is malformed', async kind => {
    const dir = dataDir();
    const file = path.join(dir, 'message-queue.json');
    const bytes = JSON.stringify({ version: 1, revision: 1, sessions: {
      [SESSION]: { directory: DIRECTORY, items: [{ id: 'broken', createdAt: 1, ...mkItem(), text: kind === 'payload' ? 7 : 'queued', target: TARGET, attempt: { id: 'old', state: kind === 'attempt' ? 'invalid' : 'unknown', createdAt: 2 } }] },
    } });
    fs.writeFileSync(file, bytes);
    const h = runtimeFor({ dir });
    await expect(h.runtime.load()).rejects.toThrow();
    await expect(h.runtime.enqueue(OTHER, DIRECTORY, mkItem())).rejects.toThrow();
    await h.runtime.flush();
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
    expect(h.sendPrompt).not.toHaveBeenCalled();
  });

  it('does not call the mutation when writing pending fails, and does not replay after accepted-result persistence fails', async () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listCommands = vi.fn(async () => ({ data: [] }));
    const first = runtimeFor({ listCommands });
    first.runtime.start();
    await first.runtime.load();
    fs.mkdirSync(path.join(first.dir, 'message-queue.json'));
    first.statuses[SESSION] = { type: 'busy' };
    await first.runtime.enqueue(SESSION, DIRECTORY, mkItem('/review'));
    await first.runtime.flush();
    first.statuses[SESSION] = {};
    first.idle();
    await settle();
    await expect.poll(() => warnings.mock.calls.some(args => args.some(arg => String(arg).includes('Could not persist queued dispatch attempt'))), { timeout: 3000 }).toBe(true);
    first.runtime.stop();
    await first.runtime.flush();
    expect(listCommands).toHaveBeenCalled();
    expect(first.sendPrompt).not.toHaveBeenCalled();
    expect(first.runtime.sessionSnapshot(SESSION).items[0]).not.toHaveProperty('attempt');

    const secondDir = dataDir();
    const sendPrompt = vi.fn(async () => {
      const file = path.join(secondDir, 'message-queue.json');
      fs.unlinkSync(file);
      fs.mkdirSync(file);
      return { accepted: true };
    });
    const h = runtimeFor({ dir: secondDir, sendPrompt }); h.runtime.start();
    await enqueueBusy(h);
    h.statuses[SESSION] = {}; h.idle(); await settle();
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    await expect.poll(() => h.runtime.sessionSnapshot(SESSION).items[0].attempt?.state, { timeout: 3000 }).toBe('unknown');
    h.runtime.stop();
    await settle(100);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });
});
