import { z } from 'zod';
import { AGENT_EXTENSION } from '../../packages/web/server/lib/agent/constants.js';
import { extensionManifestSchema } from '../../packages/web/server/lib/agent/extensions.js';
import { compileMapping, MAPPING, MAPPING_CATALOG_SCHEMA, MAPPING_SCHEMA } from './mapping-intake.mjs';

export const EXTENSION_MAPPING = Object.freeze({ ERROR: 'invalid-extension-mapping', MAX_ACTIONS: 256 });
const manifestsSchema = z.array(extensionManifestSchema).max(EXTENSION_MAPPING.MAX_ACTIONS);
const citeKey = (ref) => JSON.stringify([ref.document, ref.section]);
const fail = () => { throw new Error(EXTENSION_MAPPING.ERROR); };

/** Complete extension inventory review. This grants no host or runtime authority. */
export function compileExtensions(catalogInput, mappingInput, manifestsInput) {
  const coverage = compileMapping(catalogInput, mappingInput);
  const catalog = MAPPING_CATALOG_SCHEMA.parse(catalogInput);
  const mapping = MAPPING_SCHEMA.parse(mappingInput);
  const manifests = manifestsSchema.parse(manifestsInput);
  const actions = new Map();
  for (const endpoint of catalog.endpoints) {
    const row = mapping.endpoints[endpoint.id];
    if (row.kind !== MAPPING.ENDPOINT_KIND.EXTENSION) continue;
    const action = actions.get(row.actionID) ?? { endpointIDs: [], fits: new Set(), effects: new Set(), citations: new Set() };
    action.endpointIDs.push(endpoint.id);
    action.fits.add(row.fit);
    action.effects.add(endpoint.effect);
    row.citations.forEach((ref) => action.citations.add(citeKey(ref)));
    actions.set(row.actionID, action);
  }
  const registered = new Map();
  for (const manifest of manifests) {
    if (registered.has(manifest.actionID)) fail();
    registered.set(manifest.actionID, manifest);
  }
  const documents = new Map(catalog.documents.map((doc) => [doc.id, new Set(doc.sections)]));
  const results = [];
  for (const [actionID, action] of [...actions].sort(([left], [right]) => left.localeCompare(right))) {
    // A single action must have one reviewed interaction classification.
    if (action.fits.size !== 1) fail();
    const manifest = registered.get(actionID);
    const host = action.fits.has(MAPPING.FIT.HOST);
    const effect = action.effects.has(MAPPING.EFFECT.MUTATION) ? AGENT_EXTENSION.EFFECT.MUTATION : AGENT_EXTENSION.EFFECT.READ;
    if (host) {
      if (manifest) fail();
    } else {
      if (!manifest || manifest.effect !== effect) fail();
      const evidence = new Set(manifest.evidence.map(citeKey));
      if (manifest.evidence.some((ref) => !documents.get(ref.document)?.has(ref.section))
        || [...action.citations].some((ref) => !evidence.has(ref))) fail();
      registered.delete(actionID);
    }
    results.push(Object.freeze({ actionID, endpointIDs: Object.freeze(action.endpointIDs.sort()), effect,
      state: host ? MAPPING.FIT.HOST : MAPPING.STATE.EXTENSION, available: false }));
  }
  if (registered.size) fail();
  return Object.freeze({ mappingDigest: coverage.digest, actions: Object.freeze(results), activation: 'unavailable' });
}
