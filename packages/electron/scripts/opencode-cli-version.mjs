import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const electronPackagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SUPPORTED_MAJOR = /^[12]\./;
const supported = (version) => {
  if (!EXACT_VERSION.test(version) || !SUPPORTED_MAJOR.test(version)) return false;
  if (version.startsWith('1.')) return true;
  const [, minor, patchText] = version.split('.');
  const patch = Number(patchText.split('-')[0]);
  return Number(minor) > 0 || patch > 15 || patch === 15 && !version.includes('-');
};

export const resolveOpenCodeCliVersion = ({
  packagePath = electronPackagePath,
  environment = process.env,
} = {}) => {
  const pkg = z.object({ opencodeCli: z.object({ version: z.string() }) }).safeParse(JSON.parse(fs.readFileSync(packagePath, 'utf8')));
  const pinned = pkg.success ? pkg.data.opencodeCli.version : '';
  if (!supported(pinned)) {
    throw new Error(`packages/electron/package.json must pin opencodeCli.version exactly, got: ${pinned || '(missing)'}`);
  }
  const override = environment.OPENCHAMBER_OPENCODE_CLI_VERSION;
  if (override === undefined || override === '') return pinned;
  if (!supported(override)) throw new Error(`Invalid OpenCode CLI version: ${override}`);
  return override;
};

export const parseOpenCodeCliVersion = (output) => {
  const match = /^\s*(?:opencode\s+v?)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(String(output ?? ''));
  return match?.[1] ?? '';
};
