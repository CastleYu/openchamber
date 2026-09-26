import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { createSystemPromptRuntime } from './runtime.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('managed system prompt runtime', () => {
  it('materializes an OpenCode 2 loadable plugin directory', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-system-prompt-'));
    temporaryDirectories.push(dataDir);
    const runtime = createSystemPromptRuntime({ fsPromises: fs, path, dataDir });
    const directory = await runtime.materializePlugin();
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    expect(manifest.exports['.']).toBe('./openchamber-system-prompt-plugin.js');
    expect((await fs.stat(path.join(directory, 'openchamber-system-prompt-plugin.js'))).isFile()).toBe(true);
  });
  it.each(['build', 'plan'])('materializes the optimizer for the %s agent and preserves existing plugins', async (agent) => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-system-prompt-'));
    temporaryDirectories.push(dataDir);
    const runtime = createSystemPromptRuntime({ fsPromises: fs, path, dataDir });

    const prepared = await runtime.prepareManagedOpenCodeEnv('{ "plugin": ["file:///existing.js"], "model": "test/model" }');
    const config = JSON.parse(prepared.OPENCODE_CONFIG_CONTENT);
    const pluginPath = path.join(dataDir, 'system-prompt', 'openchamber-system-prompt-plugin.js');

    expect(config.model).toBe('test/model');
    expect(config.plugin).toEqual(['file:///existing.js', pathToFileURL(pluginPath).href]);
    const pluginModule = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
    const hooks = await pluginModule.OpenChamberSystemPromptPlugin();
    const output = {
      system: ['Behavioral prompt\nYou are powered by the model named GPT.\n<env>kept</env>'],
    };
    await hooks['chat.message'](
      { sessionID: 'session-1', ...(agent === 'build' ? { agent } : {}) },
      { message: { agent } },
    );
    await hooks['experimental.chat.system.transform']({ sessionID: 'session-1' }, output);
    expect(output.system).toEqual([
      'You are OpenCode, a coding agent.\n\nYou are powered by the model named GPT.\n<env>kept</env>',
    ]);
  });

  it('leaves an unknown prompt format unchanged', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-system-prompt-'));
    temporaryDirectories.push(dataDir);
    const runtime = createSystemPromptRuntime({ fsPromises: fs, path, dataDir });
    await runtime.prepareManagedOpenCodeEnv('{}');
    const pluginPath = path.join(dataDir, 'system-prompt', 'openchamber-system-prompt-plugin.js');
    const pluginModule = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
    const hooks = await pluginModule.OpenChamberSystemPromptPlugin();
    const output = { system: ['Unrecognized prompt'] };
    await hooks['chat.message']({ sessionID: 'session-1', agent: 'plan' });
    await hooks['experimental.chat.system.transform']({ sessionID: 'session-1' }, output);
    expect(output.system).toEqual(['Unrecognized prompt']);
  });

  it('does not transform prompts for other agents', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-system-prompt-'));
    temporaryDirectories.push(dataDir);
    const runtime = createSystemPromptRuntime({ fsPromises: fs, path, dataDir });
    await runtime.prepareManagedOpenCodeEnv('{}');
    const pluginPath = path.join(dataDir, 'system-prompt', 'openchamber-system-prompt-plugin.js');
    const pluginModule = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
    const hooks = await pluginModule.OpenChamberSystemPromptPlugin();
    const output = {
      system: ['Custom agent prompt\nYou are powered by the model named GPT.\n<env>kept</env>'],
    };

    await hooks['chat.message']({ sessionID: 'session-1', agent: 'build' });
    await hooks['chat.message']({ sessionID: 'session-1', agent: 'review' });
    await hooks['experimental.chat.system.transform']({ sessionID: 'session-1' }, output);

    expect(output.system).toEqual([
      'Custom agent prompt\nYou are powered by the model named GPT.\n<env>kept</env>',
    ]);
  });
});
