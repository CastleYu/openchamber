import os from 'node:os';
import path from 'node:path';

// Resolve once at extension startup, matching the web backend.
export const OPENCODE_CONFIG_DIR = path.join(
  process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config'),
  'opencode',
);

// OpenCode 2 honors an explicit config directory. Keep the OC1 constant above
// unchanged so an OC2 connection cannot redirect legacy file writes.
export const OPENCODE_CONFIG_DIR_V2 = process.env.OPENCODE_CONFIG_DIR?.trim()
  ? path.resolve(process.env.OPENCODE_CONFIG_DIR.trim())
  : OPENCODE_CONFIG_DIR;
