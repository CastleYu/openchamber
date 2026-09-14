import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const registryPaths = new Map();
const run = promisify(execFile);

export async function discoverWindowsIdes() {
  const script = "$roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'PyCharm|IntelliJ|WebStorm|PhpStorm|Rider|RustRover|Android Studio' } | Select-Object InstallLocation,DisplayIcon | ConvertTo-Json -Compress";
  const { stdout } = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 });
  const recordSchema = z.object({ InstallLocation: z.string().nullable().optional(), DisplayIcon: z.string().nullable().optional() });
  const records = z.union([z.array(recordSchema), recordSchema]).parse(stdout.trim() ? JSON.parse(stdout) : []);
  registryPaths.clear();
  for (const record of Array.isArray(records) ? records : [records]) {
    for (const [id, names] of Object.entries(WINDOWS_IDES)) {
      for (const name of names) {
        const candidates = [];
        if (record.InstallLocation) candidates.push(path.join(record.InstallLocation, 'bin', name));
        if (record.DisplayIcon) {
          const icon = record.DisplayIcon.replace(/,\s*-?\d+$/, '').replace(/^"|"$/g, '');
          if (path.basename(icon).toLowerCase() === name) candidates.push(icon);
        }
        for (const candidate of candidates) if (fs.existsSync(candidate)) registryPaths.set(id, candidate);
      }
    }
  }
}

export const WINDOWS_IDES = {
  pycharm: ['pycharm64.exe', 'pycharm.exe'],
  intellij: ['idea64.exe', 'idea.exe'],
  webstorm: ['webstorm64.exe'],
  phpstorm: ['phpstorm64.exe'],
  rider: ['rider64.exe'],
  rustrover: ['rustrover64.exe'],
  'android-studio': ['studio64.exe'],
};

export function findWindowsIde(id, env = process.env) {
  const installed = registryPaths.get(id);
  if (installed && fs.existsSync(installed)) return installed;
  const names = WINDOWS_IDES[id];
  if (!names) return null;
  const roots = [
    env.ProgramFiles && path.join(env.ProgramFiles, 'JetBrains'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Android', 'Android Studio'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps'),
  ].filter(Boolean);
  let visited = 0;
  const walk = (folder, depth) => {
    if (++visited > 1500 || depth > 6) return null;
    for (const name of names) {
      const candidate = path.join(folder, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    let children;
    try { children = fs.readdirSync(folder, { withFileTypes: true }); } catch { return null; }
    for (const child of children) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue;
      if (depth === 0 && folder.endsWith('Programs') && !/jetbrains|pycharm|idea|intellij|webstorm|rider|phpstorm|rustrover/i.test(child.name)) continue;
      if (/^(plugins|lib|jbr|jre|node_modules)$/i.test(child.name)) continue;
      const found = walk(path.join(folder, child.name), depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const root of roots) {
    const found = walk(root, 0);
    if (found) return found;
  }
  return null;
}
