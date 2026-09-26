import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_SCOPE,
  findWorktreeRoot,
  getAncestors,
  getJsonWriteTarget,
  readConfigFile,
  readConfigLayers,
  writeConfig,
} from './shared-v2.js';
import { findWebSearchProjectOverride, writeWebSearchSelection } from './config-v2.js';

const PROJECT_CONFIG_NAMES = Object.freeze([
  path.join('.opencode', 'opencode.jsonc'),
  path.join('.opencode', 'opencode.json'),
  'opencode.jsonc',
  'opencode.json',
]);

function requireReadableLayers(layers) {
  if (layers.layerErrors.length > 0) throw new Error('OpenCode configuration could not be read');
  return layers;
}

/** Save the OC2 websearch choice in the watched custom or user config file. */
export function setWebSearchSelection(selection) {
  const layers = requireReadableLayers(readConfigLayers(null));
  const target = getJsonWriteTarget(layers, AGENT_SCOPE.USER);
  const changed = writeWebSearchSelection(target.config, selection);
  if (changed) writeConfig(target.config, target.path);
  return { path: target.path, changed };
}

function readProjectConfigFiles(directory) {
  if (!directory) return [];
  const root = findWorktreeRoot(directory) || path.resolve(directory);
  const files = [];
  for (const base of getAncestors(directory, root)) {
    for (const name of PROJECT_CONFIG_NAMES) {
      const filePath = path.join(base, name);
      if (!fs.existsSync(filePath)) continue;
      files.push({ path: filePath, config: readConfigFile(filePath) });
    }
  }
  return files;
}

/** Return the project file that overrides Settings, if one exists. */
export function getWebSearchSource(directory) {
  const layers = requireReadableLayers(readConfigLayers(directory));
  const projectFiles = readProjectConfigFiles(directory);
  return { projectPath: findWebSearchProjectOverride(layers, projectFiles) };
}
