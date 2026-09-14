import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIdleMcpReclaimer } from './idle-reclaim.js';

afterEach(() => vi.useRealTimers());

const fixture = () => {
  vi.useFakeTimers();
  const statuses = { first: { status: 'connected' }, second: { status: 'connected' }, off: { status: 'disabled' } };
  const config = { mcp: { first: { enabled: true }, second: { enabled: true }, off: { enabled: false } } };
  const client = {
    config: { get: vi.fn(async () => ({ data: config })) },
    session: { status: vi.fn(async () => ({ data: {} })) },
    mcp: {
      status: vi.fn(async () => ({ data: structuredClone(statuses) })),
      disconnect: vi.fn(async ({ path: { name } }) => { statuses[name] = { status: 'disabled' }; }),
      connect: vi.fn(async ({ path: { name } }) => { statuses[name] = { status: 'connected' }; }),
    },
  };
  return { client, config, statuses, idle: createIdleMcpReclaimer(client) };
};

describe('managed directory idle MCP lifecycle', () => {
  it('uses client idle immediately, preserves active clients, and still verifies running sessions', async () => {
    const { client } = fixture();
    const report = vi.fn();
    const idle = createIdleMcpReclaimer(client, async () => true, report);
    await idle.check('active');
    expect(client.session.status).not.toHaveBeenCalled();
    client.session.status.mockResolvedValueOnce({ data: { current: { type: 'busy' } } });
    await idle.check('idle');
    expect(client.mcp.disconnect).not.toHaveBeenCalled();
    await idle.check('idle');
    expect(client.mcp.disconnect).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith('released', 'idle', 'first');
    await idle.restore();
    expect(client.mcp.connect).toHaveBeenCalledTimes(2);
  });

  it('retries a failed disconnect which left the server connected', async () => {
    const { client, idle } = fixture();
    client.mcp.disconnect.mockRejectedValueOnce(new Error('transport failed'));
    await idle.check('idle');
    await idle.check('idle');
    expect(client.mcp.disconnect).toHaveBeenCalledTimes(3);
    expect(idle.has('first')).toBe(true);
  });
  it('preserves a background workload and continues releasing unrelated idle services', async () => {
    const { client } = fixture();
    const canRelease = vi.fn(async (name) => name !== 'first');
    const idle = createIdleMcpReclaimer(client, canRelease);
    await vi.advanceTimersByTimeAsync(300_000);
    await idle.check();
    expect(client.mcp.disconnect.mock.calls.map(([arg]) => arg.path.name)).toEqual(['second']);
    expect(idle.has('first')).toBe(false);
  });

  it('waits five minutes and restores only connections it released', async () => {
    const { client, idle } = fixture();
    await idle.check();
    expect(client.session.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300_000);
    await idle.check();
    expect(client.mcp.disconnect.mock.calls.map(([arg]) => arg.path.name)).toEqual(['first', 'second']);
    await idle.check();
    expect(client.mcp.disconnect).toHaveBeenCalledTimes(2);
    await idle.restore();
    expect(client.mcp.connect.mock.calls.map(([arg]) => arg.path.name)).toEqual(['first', 'second']);
    expect(idle.has('first')).toBe(false);
  });

  it('preserves busy, retrying, and unavailable scopes', async () => {
    const { client, idle } = fixture();
    for (const type of ['busy', 'retry']) {
      await vi.advanceTimersByTimeAsync(300_000);
      client.session.status.mockResolvedValueOnce({ data: { other: { type } } });
      await idle.check();
    }
    await vi.advanceTimersByTimeAsync(300_000);
    client.session.status.mockResolvedValueOnce({ error: 'unavailable' });
    await idle.check();
    client.session.status.mockRejectedValueOnce(new Error('offline'));
    await expect(idle.check()).rejects.toThrow('offline');
    expect(client.mcp.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a stale idle snapshot when a new prompt arrives', async () => {
    const { client, idle } = fixture();
    await vi.advanceTimersByTimeAsync(300_000);
    let resolve;
    client.session.status.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const checking = idle.check();
    await Promise.resolve();
    const restoring = idle.restore();
    resolve({ data: {} });
    await Promise.all([checking, restoring]);
    expect(client.mcp.disconnect).not.toHaveBeenCalled();
  });

  it('waits for an in-flight disconnect before restoring for a new prompt', async () => {
    const { client, idle } = fixture();
    await vi.advanceTimersByTimeAsync(300_000);
    let finish;
    client.mcp.disconnect.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const checking = idle.check();
    await vi.advanceTimersByTimeAsync(0);
    const restoring = idle.restore();
    expect(client.mcp.connect).not.toHaveBeenCalled();
    finish();
    await Promise.all([checking, restoring]);
    expect(client.mcp.disconnect).toHaveBeenCalledTimes(1);
    expect(client.mcp.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps failed restores retryable and honors disabled configuration', async () => {
    const { client, config, idle } = fixture();
    await vi.advanceTimersByTimeAsync(300_000);
    client.mcp.disconnect.mockRejectedValueOnce(new Error('lost response'));
    await idle.check();
    expect(client.mcp.disconnect).toHaveBeenCalledTimes(2);
    config.mcp.second.enabled = false;
    client.mcp.connect.mockRejectedValueOnce(new Error('offline'));
    await expect(idle.restore()).rejects.toThrow('Unable to restore');
    expect(idle.has('first')).toBe(true);
    expect(idle.has('second')).toBe(false);
    await idle.restore();
    expect(idle.has('first')).toBe(false);
  });

  it('stops cleanup after disposal even with a pending snapshot', async () => {
    const { client, idle } = fixture();
    await vi.advanceTimersByTimeAsync(300_000);
    client.session.status.mockImplementationOnce(async () => {
      idle.dispose();
      return { data: {} };
    });
    await idle.check();
    await idle.restore();
    expect(client.mcp.disconnect).not.toHaveBeenCalled();
    expect(client.mcp.connect).not.toHaveBeenCalled();
  });
});
