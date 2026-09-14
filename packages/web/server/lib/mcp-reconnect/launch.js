import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BGPM = { name: '@waylaidwanderer/background-process-mcp', version: '1.2.8' };
const quote = (text) => `'${text.replaceAll("'", "''")}'`;

export async function prepareMcpLaunch(dataDir) {
  if (process.platform !== 'win32') return null;
  const directory = path.join(dataDir, 'mcp-runtime');
  await fs.mkdir(directory, { recursive: true });
  const source = await fs.readFile(new URL('./windows-job.cs', import.meta.url), 'utf8');
  const revision = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const guard = path.join(directory, `mcp-job-${revision}.exe`);
  try { await fs.access(guard); } catch {
    const temporary = path.join(directory, `mcp-job-${revision}-${process.pid}.exe`);
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const sourcePath = `${temporary}.cs`;
    await fs.writeFile(sourcePath, source);
    const command = `$ErrorActionPreference='Stop'; Add-Type -Path ${quote(sourcePath)} -OutputAssembly ${quote(temporary)} -OutputType ConsoleApplication -ReferencedAssemblies System.dll,System.Core.dll`;
    try {
      await exec(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30000 });
      try { await fs.rename(temporary, guard); } catch (error) { await fs.access(guard).catch(() => { throw error; }); }
    } finally { await fs.rm(temporary, { force: true }); await fs.rm(sourcePath, { force: true }); }
  }

  // Reuse an already installed package. Never npm-install or contact a registry.
  const fixed = path.join(directory, `background-process-${BGPM.version}`);
  const entry = path.join(fixed, 'node_modules', BGPM.name, 'dist/cli.js');
  let bgpm = null;
  try { await fs.access(entry); bgpm = entry; } catch {
    const cache = process.env.npm_config_cache || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'npm-cache');
    const prefixes = await fs.readdir(path.join(cache, '_npx')).catch(() => []);
    for (const prefix of prefixes) {
      const modules = path.join(cache, '_npx', prefix, 'node_modules');
      const pkg = await fs.readFile(path.join(modules, BGPM.name, 'package.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (pkg?.name !== BGPM.name || pkg.version !== BGPM.version) continue;
      await fs.access(path.join(modules, BGPM.name, 'dist/cli.js'));
      const temporary = `${fixed}-${process.pid}.staging`;
      try {
        await fs.cp(modules, path.join(temporary, 'node_modules'), { recursive: true, dereference: true });
        try { await fs.rename(temporary, fixed); } catch (error) { await fs.access(entry).catch(() => { throw error; }); }
        bgpm = entry;
      } finally { await fs.rm(temporary, { recursive: true, force: true }); }
      break;
    }
  }
  let node = null;
  if (bgpm) {
    const result = await exec('where.exe', ['node.exe'], { windowsHide: true, timeout: 5000 });
    node = result.stdout.trim().split(/\r?\n/)[0];
    await fs.access(node);
  }
  return { guard, node, bgpm, states: path.join(directory, 'connections') };
}

/** Serialized into the managed plugin. Dependencies are provided explicitly. */
export function configureMcpLaunch(config, directory, launch, hash, join) {
  const background = new Map();
  if (!launch) return background;
  const packageName = '@waylaidwanderer/background-process-mcp';
  for (const [name, entry] of Object.entries(config.mcp || {})) {
    if (entry.type !== 'local' || entry.enabled === false || !Array.isArray(entry.command) || !entry.command.length) continue;
    let command = entry.command[0] === launch.guard ? entry.command.slice(2) : entry.command;
    const index = command.findIndex((value) => value === packageName || value === `${packageName}@latest` || value === `${packageName}@1.2.8`);
    const isBackground = index >= 0 || command.some((value) => value.includes('background-process-mcp'));
    const canDirect = /(?:^|[\\/])npx(?:\.cmd|\.exe)?$/i.test(command[0]) && index > 0
      && command.slice(1, index).every((value) => ['-y', '--yes', '--offline', '--no-install', '--no'].includes(value));
    if (canDirect && launch.bgpm && launch.node) command = [launch.node, launch.bgpm, ...command.slice(index + 1)];
    const state = join(launch.states, hash(`${directory}\n${name}`));
    background.set(name, { state, background: isBackground, inspect: isBackground && command[1] === launch.bgpm && !command.some((value) => value === '--port' || value.startsWith('--port=')) });
    entry.command = [launch.guard, state, ...command];
  }
  return background;
}
