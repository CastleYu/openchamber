import fs from 'fs';
import path from 'path';
import os from 'os';
import { configureOpenCodeCredentials as configureV2Credentials, getProviderAuth as getV2ProviderAuth, openCodeCredentialSource, readOpenCodeCredentials as readV2Credentials } from './auth-v2.js';
import { getProviderAuth as getLegacyV2ProviderAuth, readAuthFile as readLegacyV2Credentials } from './auth-v2-legacy.js';
import { OPENCODE_PROFILE, isSupportedOpenCodeVersion, supportsCredentialApi } from './compatibility.js';

import { supportsLegacyStream } from './legacy-contract.js';
import { AGENT_ERROR } from '../agent/constants.js';

let getRuntime = () => ({ generation: 'oc1' });
let legacyReader = null;

export { openCodeCredentialSource };
const assertProfile = (runtime = getRuntime()) => {
  if (runtime.profile === OPENCODE_PROFILE.LEGACY) {
    throw Object.assign(new Error('Legacy credential access is not accepted'), { statusCode: 501, code: AGENT_ERROR.UNACCEPTED });
  }
  return runtime;
};
export const getOpenCodeCredentialGeneration = () => assertProfile().generation;

export function configureOpenCodeCredentials(runtime, source, legacy = null) {
  getRuntime = runtime;
  legacyReader = legacy;
  configureV2Credentials(source);
}

async function readLegacyCredentials(selected) {
  const reader = legacyReader;
  if (!supportsLegacyStream(selected) || !reader) assertProfile(selected);
  const check = () => {
    const current = getRuntime();
    if (reader !== legacyReader || current.generation !== selected.generation || current.profile !== selected.profile
      || current.version !== selected.version || current.endpoint !== selected.endpoint || current.epoch !== selected.epoch) {
      throw Object.assign(new Error('OpenCode runtime changed during credential read'), { statusCode: 409 });
    }
  };
  try {
    const credentials = await reader.read();
    check();
    return credentials;
  } catch (error) {
    check();
    throw error;
  }
}

/** Read the active kernel's credentials without letting OC2 use the OC1 file. */
export async function readOpenCodeCredentials() {
  const selected = getRuntime();
  if (selected.profile === OPENCODE_PROFILE.LEGACY) return readLegacyCredentials(selected);
  assertProfile(selected);
  if (selected.generation === 'oc1') return readAuthFile();
  if (selected.generation !== 'oc2') throw new Error('OpenCode generation is not ready');
  if (!selected.version || !isSupportedOpenCodeVersion(selected.version)) throw new Error('OpenCode version is not known for credential access');
  const credentials = supportsCredentialApi(selected.version)
    ? await readV2Credentials()
    : readLegacyV2Credentials();
  const current = getRuntime();
  if (current.generation !== selected.generation || current.profile !== selected.profile || current.endpoint !== selected.endpoint || current.epoch !== selected.epoch) {
    throw new Error('OpenCode runtime changed during credential read');
  }
  return credentials;
}

const OPENCODE_DATA_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');
const AUTH_FILE = path.join(OPENCODE_DATA_DIR, 'auth.json');

function readAuthFile() {
  assertProfile();
  if (!fs.existsSync(AUTH_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(AUTH_FILE, 'utf8');
    const trimmed = content.trim();
    if (!trimmed) {
      return {};
    }
    return JSON.parse(trimmed);
  } catch (error) {
    console.error('Failed to read auth file:', error);
    throw new Error('Failed to read OpenCode auth configuration');
  }
}

function writeAuthFile(auth) {
  assertProfile();
  try {
    if (!fs.existsSync(OPENCODE_DATA_DIR)) {
      fs.mkdirSync(OPENCODE_DATA_DIR, { recursive: true, mode: 0o700 });
    }
    if (process.platform !== 'win32') fs.chmodSync(OPENCODE_DATA_DIR, 0o700);

    if (fs.existsSync(AUTH_FILE)) {
      const backupFile = `${AUTH_FILE}.openchamber.backup`;
      fs.copyFileSync(AUTH_FILE, backupFile);
      if (process.platform !== 'win32') fs.chmodSync(backupFile, 0o600);
      console.log(`Created auth backup: ${backupFile}`);
    }

    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(AUTH_FILE, 0o600);
    console.log('Successfully wrote auth file');
  } catch (error) {
    console.error('Failed to write auth file:', error);
    throw new Error('Failed to write OpenCode auth configuration');
  }
}

function removeProviderAuth(providerId) {
  if (!providerId || typeof providerId !== 'string') {
    throw new Error('Provider ID is required');
  }

  const auth = readAuthFile();

  if (!auth[providerId]) {
    console.log(`Provider ${providerId} not found in auth file, nothing to remove`);
    return false;
  }

  delete auth[providerId];
  writeAuthFile(auth);
  console.log(`Removed provider auth: ${providerId}`);
  return true;
}

async function getProviderAuth(providerId) {
  const selected = getRuntime();
  if (selected.profile === OPENCODE_PROFILE.LEGACY) {
    const credentials = await readLegacyCredentials(selected);
    return Object.hasOwn(credentials, providerId) ? credentials[providerId] : null;
  }
  assertProfile(selected);
  if (selected.generation === 'oc1') return readAuthFile()[providerId] || null;
  if (selected.generation !== 'oc2' || !selected.version || !isSupportedOpenCodeVersion(selected.version)) {
    throw new Error('OpenCode version is not known for credential access');
  }
  const auth = supportsCredentialApi(selected.version)
    ? await getV2ProviderAuth(providerId)
    : getLegacyV2ProviderAuth(providerId);
  const current = getRuntime();
  if (current.generation !== selected.generation || current.profile !== selected.profile || current.endpoint !== selected.endpoint || current.epoch !== selected.epoch) {
    throw new Error('OpenCode runtime changed during credential read');
  }
  return auth;
}

function listProviderAuths() {
  const auth = readAuthFile();
  return Object.keys(auth);
}

export {
  readAuthFile,
  writeAuthFile,
  removeProviderAuth,
  getProviderAuth,
  listProviderAuths,
  AUTH_FILE,
  OPENCODE_DATA_DIR
};
