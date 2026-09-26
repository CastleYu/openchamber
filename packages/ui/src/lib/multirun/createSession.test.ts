import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { JsonValue, Session } from '@/lib/opencode/model';
import { createMultiRunSession, type MultiRunGeneration, type MultiRunSessionApi } from './createSession';
import { getMultiRunIdentity, getMultiRunMembership, withMultiRunMembership, type MultiRunIdentity } from './identity';

const identity: Omit<MultiRunIdentity, 'key'> = {
  group: { kind: 'id', id: '9f512893-6e63-4e49-a534-5de733ca103e' },
  groupSlug: 'bench', providerID: 'openrouter', modelID: 'vendor/model', role: 'run',
};

const base: Session = {
  id: 'ses_new', projectID: 'p', directory: '/repo', title: '', time: { created: 1, updated: 1 },
};
const jsonObjectSchema = z.record(z.string(), z.json());
const jsonObject = (value: JsonValue | undefined) => jsonObjectSchema.safeParse(value).data ?? {};

function fixture(generation: MultiRunGeneration, options: {
  rejectUpdate?: boolean; omitSavedMarker?: boolean; switchAfterCreate?: boolean;
} = {}) {
  const calls: string[] = [];
  const creation: Array<Parameters<MultiRunSessionApi['createSession']>[0]> = [];
  let current = true;
  let stored = base;
  const api: MultiRunSessionApi = {
    async createSession(input, directory) {
      calls.push('create');
      expect(directory).toBe('/repo');
      creation.push(input);
      stored = { ...base, title: input?.title ?? '', metadata: input?.metadata };
      expect(getMultiRunIdentity(stored)).toBeNull();
      if (options.switchAfterCreate) current = false;
      return stored;
    },
    async getSession(id, directory) {
      calls.push('get');
      expect([id, directory]).toEqual(['ses_new', '/repo']);
      stored = { ...stored, metadata: {
        ...stored.metadata,
        external: 'preserve',
        openchamber: { ...jsonObject(stored.metadata?.openchamber), goal: { status: 'active' }, reviewSessionID: 'review-id' },
      } };
      return stored;
    },
    async updateSession(id, patch, directory) {
      calls.push('update');
      expect([id, directory]).toEqual(['ses_new', '/repo']);
      if (options.rejectUpdate) throw new Error('write failed');
      if (generation === 'oc1') {
        stored = { ...stored, metadata: patch.metadata };
      } else {
        // The OC2 route merges the submitted marker into current metadata.
        stored = { ...stored, metadata: {
          ...stored.metadata,
          ...patch.metadata,
          openchamber: { ...jsonObject(stored.metadata?.openchamber), ...jsonObject(patch.metadata?.openchamber) },
        } };
      }
      if (options.omitSavedMarker) stored = { ...stored, metadata: {} };
      return stored;
    },
    async deleteSession(id, directory) {
      calls.push('delete');
      expect([id, directory]).toEqual(['ses_new', '/repo']);
      return true;
    },
  };
  const assertCurrent = () => { if (!current) throw new Error('Runtime changed'); };
  return { api, calls, creation, assertCurrent, get stored() { return stored; }, setStored(value: Session) { stored = value; } };
}

describe('multi-run creation through the domain facade', () => {
  for (const generation of ['oc1', 'oc2'] as const) {
    for (const role of ['run', 'fusion'] as const) {
      test(`${generation} binds ${role} to the server ID before returning`, async () => {
        const testApi = fixture(generation);
        const result = await createMultiRunSession(testApi.api, {
          title: 'any title', directory: '/repo', generation, identity: { ...identity, role },
          selection: { model: { providerID: 'openrouter', id: 'vendor/model' }, agent: 'build' },
        }, testApi.assertCurrent);
        expect(getMultiRunMembership(result)?.role).toBe(role);
        expect(getMultiRunIdentity({ ...result, id: 'fork' })).toBeNull();
        expect(testApi.creation[0]?.model).toEqual(generation === 'oc2' ? { providerID: 'openrouter', id: 'vendor/model' } : undefined);
        expect(testApi.creation[0]?.agent).toBe(generation === 'oc2' ? 'build' : undefined);
        expect(testApi.calls).toEqual(generation === 'oc1' ? ['create', 'get', 'update'] : ['create', 'update']);
      });
    }
  }

  test('OC1 full update retains unrelated metadata from its fresh read', async () => {
    const testApi = fixture('oc1');
    const result = await createMultiRunSession(testApi.api, { title: 'bench', directory: '/repo', generation: 'oc1', identity }, testApi.assertCurrent);
    expect(result.metadata?.external).toBe('preserve');
    expect(result.metadata?.openchamber).toMatchObject({ goal: { status: 'active' }, reviewSessionID: 'review-id' });
  });

  test('OC2 narrow patch preserves metadata added concurrently', async () => {
    const testApi = fixture('oc2');
    const api: MultiRunSessionApi = {
      ...testApi.api,
      async updateSession(id, patch, directory) {
        const current = testApi.stored;
        testApi.setStored({ ...current, metadata: {
          ...current.metadata,
          external: 'added during binding',
          openchamber: { ...jsonObject(current.metadata?.openchamber), reviewSessionID: 'new review' },
        } });
        return testApi.api.updateSession(id, patch, directory);
      },
    };
    const result = await createMultiRunSession(api, { title: 'bench', directory: '/repo', generation: 'oc2', identity }, testApi.assertCurrent);
    expect(result.metadata?.external).toBe('added during binding');
    expect(result.metadata?.openchamber).toMatchObject({ reviewSessionID: 'new review', multirun: { sessionID: 'ses_new' } });
  });

  for (const generation of ['oc1', 'oc2'] as const) {
    for (const failure of [{ rejectUpdate: true }, { omitSavedMarker: true }]) {
      test(`${generation} cleans an unbound session after ${JSON.stringify(failure)}`, async () => {
        const testApi = fixture(generation, failure);
        await expect(createMultiRunSession(testApi.api, { title: 'bench', directory: '/repo', generation, identity }, testApi.assertCurrent)).rejects.toThrow();
        expect(testApi.calls.at(-1)).toBe('delete');
      });
    }
  }

  test('a runtime switch prevents binding and cleanup on the new runtime', async () => {
    const testApi = fixture('oc2', { switchAfterCreate: true });
    await expect(createMultiRunSession(testApi.api, { title: 'bench', directory: '/repo', generation: 'oc2', identity }, testApi.assertCurrent)).rejects.toThrow('Runtime changed');
    expect(testApi.calls).toEqual(['create']);
  });
});
