import { AGENT_ERROR, AGENT_FAMILY } from '../agent/constants.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMessageQueueRuntime } from '../message-queue/runtime.js';
import { createOpenCodeLifecycleRuntime } from './lifecycle.js';

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const createRuntime = (waitForReady, state, startupMs = 1500) => createOpenCodeLifecycleRuntime({
  state,
  env: { ENV_CONFIGURED_OPENCODE_PORT: 45678, ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1' },
  syncToHmrState() {}, syncFromHmrState() {},
  ensureOpencodeCliEnv: () => process.execPath,
  applyOpencodeBinaryFromSettings: async () => {},
  ensureLocalOpenCodeServerPassword: async () => 'fixture-only',
  resolveManagedOpenCodeLaunchSpec: (binary) => ({ binary, args: [] }),
  // Node runs the fixture's `serve` file, but its own --version is not an OpenCode version.
  // The real probe remains covered by managed-generation.test.js.
  probeManagedOpenCodeGeneration: ({ resolvedBinary, resolveManagedOpenCodeLaunchSpec }) => ({
    generation: 'oc1', version: '1.2.27', launchSpec: resolveManagedOpenCodeLaunchSpec(resolvedBinary),
  }),
  normalizeApiPrefix: (value) => value,
  setOpenCodePort() {}, setDetectedOpenCodeApiPrefix() {},
  waitForReady,
  managedStartupTimeoutMs: startupMs,
});

describe('managed process lifecycle with real children', () => {
  for (const failure of ['invalid-readiness', 'health-error', 'startup-timeout', 'shutdown-during-startup', 'none']) {
    it(`reaps the server and its child after ${failure}`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-process-'));
      const previousRegistry = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
      process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = path.join(root, 'registry');
      const marker = path.join(root, 'pids');
      const childScript = `process.on('SIGTERM', () => {}); require('node:fs').appendFileSync(${JSON.stringify(marker)}, process.pid + '\\n'); process.stdout.write('ready\\n'); setInterval(() => {}, 1000);`;
      let readinessMessage = 'opencode server listening on http://127.0.0.1:45678\n';
      if (failure === 'invalid-readiness') readinessMessage = 'opencode server listening without a URL\n';
      if (failure === 'startup-timeout' || failure === 'shutdown-during-startup') readinessMessage = '';
      // Node is an isolated stand-in for the native OpenCode binary. Lifecycle
      // still launches its real `serve --hostname ... --port ...` command.
      await fs.writeFile(path.join(root, 'serve'), `
        const fs = require('node:fs');
        fs.appendFileSync(${JSON.stringify(marker)}, process.pid + '\\n');
        const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: ['ignore', 'pipe', 'ignore'] });
        child.stdout.once('data', () => {
          process.stdout.write(${JSON.stringify(readinessMessage)});
        });
        setInterval(() => {}, 1000);
      `);
      try {
        const state = { openCodeWorkingDirectory: root, useWslForOpencode: false };
        const runtime = createRuntime(async () => {
          if (failure === 'health-error') throw new Error('fixture health failure');
          return true;
        }, state, failure === 'shutdown-during-startup' ? 20_000 : 1500);
        if (failure === 'none') {
          const server = await runtime.startOpenCode();
          await Promise.all([server.close(), server.close()]);
        } else if (failure === 'shutdown-during-startup') {
          const starting = runtime.startOpenCode();
          // Shutdown closes a real Windows process tree, independently of the
          // short deadline exercised by the separate startup-timeout case.
          const rejected = starting.catch(error => error);
          await expect.poll(async () => (await fs.readFile(marker, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length).toBe(2);
          state.isShuttingDown = true;
          await state.openCodeProcess.close();
          expect(await rejected).toMatchObject({ message: expect.stringContaining('exited before serving') });
        } else if (failure === 'startup-timeout') {
          await expect(runtime.startOpenCode()).rejects.toThrow('Timeout waiting for OpenCode');
        } else {
          await expect(runtime.startOpenCode()).rejects.toThrow(failure === 'health-error' ? 'fixture health failure' : 'Failed to parse server url');
        }
        const pids = (await fs.readFile(marker, 'utf8')).trim().split('\n').map(Number);
        expect(pids).toHaveLength(failure === 'none' || failure === 'shutdown-during-startup' ? 2 : 4);
        await expect.poll(() => pids.filter(alive), { timeout: 3000 }).toEqual([]);
        await expect.poll(() => fs.readdir(path.join(root, 'registry')), { timeout: 3000 }).toEqual([]);
      } finally {
        const pids = (await fs.readFile(marker, 'utf8').catch(() => '')).trim().split('\n').map(Number).filter((pid) => pid > 0);
        for (const pid of pids.reverse()) {
          if (!alive(pid)) continue;
          try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
        }
        if (previousRegistry === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
        else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previousRegistry;
        await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    }, failure === 'shutdown-during-startup' ? 25_000 : 15_000);
  }
});

describe('complete server command with a real owned child', () => {
  it('passes the exact arguments, cwd and referenced environment without native config injection', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-command-'));
    const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = path.join(root, 'registry');
    const script = path.join(root, 'server.cjs');
    const marker = path.join(root, 'invocation.json');
    await fs.writeFile(script, "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ", JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),reference:process.env.OC_COMMAND_REF,pid:process.pid})); process.stdout.write('server listening on http://127.0.0.1:45678\\n'); setInterval(()=>{},1000);");
    const state = { openCodeWorkingDirectory: root, useWslForOpencode: false, openCodePort: null };
    const runtime = createOpenCodeLifecycleRuntime({
      state, env: { ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1' },
      getConnection: async () => ({ mode: 'command', binary: process.execPath, launchSpec: { binary: process.execPath, args: [] }, args: [script, 'literal argument'], cwd: root, commandEnv: { OC_COMMAND_REF: 'fixture-reference' } }),
      syncToHmrState() {}, ensureLocalOpenCodeServerPassword: async () => 'fixture-only',
      getManagedOpenCodeEnv: () => { throw new Error('Command must own its config'); },
      probeManagedOpenCodeGeneration: () => { throw new Error('Command is not a CLI version probe'); },
      waitForReady: async () => true, normalizeApiPrefix: value => value,
      setOpenCodePort: port => { state.openCodePort = port; }, setDetectedOpenCodeApiPrefix() {},
      managedStartupTimeoutMs: 1500,
    });
    let server;
    try {
      server = await runtime.startOpenCode();
      const invocation = JSON.parse(await fs.readFile(marker, 'utf8'));
      expect(invocation).toMatchObject({ args: ['literal argument'], cwd: root, reference: 'fixture-reference' });
      expect(state.lastOpenCodeLaunchDiagnostics.args).toEqual([]);
      expect(state.openCodeBaseUrl).toBe('http://127.0.0.1:45678');
      await server.close(); expect(alive(invocation.pid)).toBe(false);
      expect(await fs.readdir(path.join(root, 'registry'))).toEqual([]);
    } finally {
      await server?.close();
      if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
      else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 10_000);
});


describe('confirmed restart with real owned children', () => {
  it('replaces a complete command only after exit and preserves external ownership across retries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-replace-'));
    const previous = process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY;
    process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = path.join(root, 'registry');
    const script = path.join(root, 'server.cjs'); const marker = path.join(root, 'pids');
    await fs.writeFile(script, "require('node:fs').appendFileSync(" + JSON.stringify(marker) + ", process.pid + '\\n'); process.stdout.write('server listening on http://127.0.0.1:45678\\n'); setInterval(()=>{},1000);");
    const state = { openCodeWorkingDirectory: root, useWslForOpencode: false, openCodePort: null, currentRestartPromise: null };
    const command = { mode: 'command', binary: process.execPath, launchSpec: { binary: process.execPath, args: [] }, args: [script], cwd: root, commandEnv: {} };
    let record = command; let resolutions = 0; let revision = 1; let connectionRevision = 1; let retire = false;
    let releaseSend; let entered = false; let delivered = 0; let pauseEntered = false;
    const accepted = new Promise(resolve => { releaseSend = resolve; });
    const queue = createMessageQueueRuntime({
      dataDir: path.join(root, 'queue'), dispatchQuietMs: 0,
      getQueueTarget: async () => 'a'.repeat(64),
      globalEventHub: { subscribeEvent: () => () => {}, subscribeStatus: () => () => {} },
      kernelOperations: {
        captureIdentity: () => ({ generation: 'oc2', profile: 'oc2', endpoint: 'fixture', epoch: 1 }),
        listActiveStatuses: async () => ({ data: {} }),
        listChildren: async () => ({ data: [] }),
        listMessages: async () => ({ data: { order: 'desc', items: [] } }),
        sendPrompt: async () => { entered = true; await accepted; delivered += 1; },
      },
    });
    const runtime = createOpenCodeLifecycleRuntime({
      state, env: { ENV_CONFIGURED_OPENCODE_HOSTNAME: '127.0.0.1' },
      getConnection: async () => { resolutions += 1; return record; },
      pauseQueuedDispatch: () => { pauseEntered = true; return queue.pauseDispatch(); },
      getBackendSelection: () => ({ family: AGENT_FAMILY.OPENCODE, revision, connectionRevision }),
      syncToHmrState() {}, ensureLocalOpenCodeServerPassword: async () => 'fixture-only',
      getManagedOpenCodeEnv: () => { throw new Error('Command owns config'); },
      waitForReady: async () => true, normalizeApiPrefix: value => value,
      setOpenCodePort: port => { state.openCodePort = port; }, setDetectedOpenCodeApiPrefix() {},
      reapManagedOrphanedProcesses: async () => ({ reaped: 0 }),
      kernelRuntime: { invalidate() {}, refresh: async () => { if (retire) revision += 1; return { generation: 'oc2' }; } },
      managedStartupTimeoutMs: 1500,
    });
    const pids = [];
    try {
      await runtime.bootstrapOpenCodeAtStartup(); const first = state.openCodeProcess.pid; pids.push(first);
      expect(alive(first)).toBe(true); expect(state.isOpenCodeReady).toBe(true);
      await queue.enqueue('ses_drain_real', root, { content: 'fixture', text: 'fixture', sendConfig: { providerID: 'fixture', modelID: 'fixture' } });
      await vi.waitFor(() => expect(entered).toBe(true));
      const replacements = Promise.all([runtime.restartOpenCode(), runtime.restartOpenCode()]);
      await vi.waitFor(() => expect(pauseEntered).toBe(true));
      expect(alive(first)).toBe(true); expect(state.isOpenCodeReady).toBe(true);
      releaseSend(); await replacements;
      expect(delivered).toBe(1);
      expect(JSON.parse(await fs.readFile(path.join(root, 'queue', 'message-queue.json'), 'utf8')).sessions).toEqual({});
      const second = state.openCodeProcess.pid; pids.push(second);
      expect(second).not.toBe(first); expect(alive(first)).toBe(false); expect(alive(second)).toBe(true);
      expect(resolutions).toBe(2); expect(await fs.readdir(path.join(root, 'registry'))).toHaveLength(1);
      const external = { mode: 'external', endpoint: 'https://external.test/base' };
      await runtime.restartOpenCode('confirmed-change', {
        resolve: async () => external,
        beforeRetire: async () => {},
        commit: async () => {
          expect(alive(second)).toBe(false);
          record = external; connectionRevision += 1;
          return { family: AGENT_FAMILY.OPENCODE, revision, connectionRevision };
        },
      });
      expect(alive(second)).toBe(false);
      expect(state.openCodeProcess).toBeNull(); expect(state.openCodeBaseUrl).toBe(record.endpoint);
      expect(state.isExternalOpenCode).toBe(true); expect(await fs.readdir(path.join(root, 'registry'))).toEqual([]);
      await runtime.restartOpenCode('explicit-return', {
        resolve: async () => command,
        beforeRetire: async () => {},
        commit: async () => {
          record = command; connectionRevision += 1;
          return { family: AGENT_FAMILY.OPENCODE, revision, connectionRevision };
        },
      });
      const third = state.openCodeProcess.pid; pids.push(third);
      expect(alive(third)).toBe(true); expect(state.isExternalOpenCode).toBe(false);
      expect((await fs.readFile(marker, 'utf8')).trim().split('\n').map(Number)).toEqual(pids);
      const invalid = path.join(root, 'invalid.cjs'); await fs.writeFile(invalid, 'process.exit(1);');
      record = { ...command, args: [invalid] };
      await expect(runtime.restartOpenCode()).rejects.toThrow();
      expect(alive(third)).toBe(false); expect(state.openCodeProcess).toBeNull();
      expect(state.isOpenCodeReady).toBe(false); expect(state.lastOpenCodeError).toBeTruthy();
      expect(await fs.readdir(path.join(root, 'registry'))).toEqual([]);
      record = command; await runtime.restartOpenCode(); pids.push(state.openCodeProcess.pid);
      expect(state.isOpenCodeReady).toBe(true);
      retire = true;
      await expect(runtime.restartOpenCode()).rejects.toMatchObject({ code: AGENT_ERROR.CHANGED });
      pids.push(Number((await fs.readFile(marker, 'utf8')).trim().split('\n').at(-1)));
      expect(state.openCodeProcess).toBeNull(); expect(state.openCodePort).toBeNull();
      expect(state.isOpenCodeReady).toBe(false); expect(pids.every(pid => !alive(pid))).toBe(true);
      expect(await fs.readdir(path.join(root, 'registry'))).toEqual([]);
    } finally {
      releaseSend(); queue.stop(); await queue.flush();
      await state.openCodeProcess?.close();
      for (const pid of pids) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
      if (previous === undefined) delete process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY; else process.env.OPENCHAMBER_MANAGED_PROCESS_REGISTRY = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 35_000);
});
