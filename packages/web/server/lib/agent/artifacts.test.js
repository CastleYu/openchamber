import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_ARTIFACT, AGENT_ERROR } from './constants.js';
import { AgentArtifactError, agentArtifactDigest, verifyAgentArtifacts } from './artifacts.js';

const roots = new Set();
const makeRoot = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-agent-artifacts-'));
  roots.add(directory);
  return directory;
};
const record = (name, bytes) => ({
  path: name,
  bytes: bytes.length,
  digest: createHash('sha256').update(bytes).digest('hex'),
});
const manifest = (files) => ({
  version: AGENT_ARTIFACT.VERSION,
  artifactDigest: agentArtifactDigest(files),
  files,
});
const writeFiles = async (directory, files) => {
  for (const file of files) {
    const target = path.join(directory, ...file.path.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content);
  }
};
const verifyError = async (directory, expected, code) => {
  await expect(verifyAgentArtifacts({ directory, manifest: expected })).rejects.toMatchObject({
    name: 'AgentArtifactError', code,
  });
};
const invalidFiles = (files) => {
  let error;
  try {
    agentArtifactDigest(files);
  } catch (value) {
    error = value;
  }
  expect(error).toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
};
const unavailablePrivilege = (error) => ['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code);

afterEach(async () => {
  await Promise.all([...roots].map((directory) => fs.rm(directory, { recursive: true, force: true })));
  roots.clear();
});

describe('agent artifact verification', () => {
  it('accepts nested, binary, and empty files with the canonical digest', async () => {
    const directory = await makeRoot();
    const files = [
      { path: 'nested/text.txt', content: Buffer.from('hello') },
      { path: 'image.bin', content: Buffer.from([0, 255, 4, 0, 128]) },
      { path: 'empty', content: Buffer.alloc(0) },
      { path: 'chunks.bin', content: Buffer.alloc(131073, 42) },
    ];
    await writeFiles(directory, files);
    const expected = manifest(files.map((file) => record(file.path, file.content)));
    await expect(verifyAgentArtifacts({ directory, manifest: expected })).resolves.toEqual({
      artifactDigest: expected.artifactDigest, files: 4,
    });
    expect(Object.isFrozen(await verifyAgentArtifacts({ directory, manifest: expected }))).toBe(true);
  });

  it('computes the same digest independent of input order', () => {
    const files = [record('b', Buffer.from('b')), record('a', Buffer.from('a'))];
    expect(agentArtifactDigest(files)).toBe(agentArtifactDigest([...files].reverse()));
    const tuples = [files[1], files[0]].map((file) => [file.path, file.bytes, file.digest]);
    expect(agentArtifactDigest(files)).toBe(createHash('sha256')
      .update(JSON.stringify([AGENT_ARTIFACT.VERSION, tuples])).digest('hex'));
  });

  it('captures the protected manifest before asynchronous filesystem reads', async () => {
    const directory = await makeRoot();
    await fs.writeFile(path.join(directory, 'file'), 'original');
    const expected = manifest([record('file', Buffer.from('original'))]);
    const pending = verifyAgentArtifacts({ directory, manifest: expected });
    expected.files[0].digest = '0'.repeat(64);
    expected.files[0].path = '../replaced';
    expected.artifactDigest = '0'.repeat(64);
    await expect(pending).resolves.toMatchObject({ files: 1 });
  });

  it('rejects changed same-size bytes and declared size mismatches', async () => {
    const directory = await makeRoot();
    const bytes = Buffer.from('secret-payload');
    const expected = manifest([record('payload', bytes)]);
    await fs.writeFile(path.join(directory, 'payload'), Buffer.alloc(bytes.length, 42));
    await verifyError(directory, expected, AGENT_ERROR.ARTIFACT_MISMATCH);
    await fs.writeFile(path.join(directory, 'payload'), bytes);
    const wrongSize = manifest([{ ...expected.files[0], bytes: bytes.length + 1 }]);
    await verifyError(directory, wrongSize, AGENT_ERROR.ARTIFACT_MISMATCH);
  });

  it('rejects missing files and extra files or directories with fixed boundary errors', async () => {
    const directory = await makeRoot();
    const expected = manifest([record('kept', Buffer.from('kept'))]);
    await verifyError(directory, expected, AGENT_ERROR.ARTIFACT_UNAVAILABLE);
    await fs.writeFile(path.join(directory, 'kept'), 'kept');
    await fs.writeFile(path.join(directory, 'extra'), 'private-extra-data');
    await verifyError(directory, expected, AGENT_ERROR.ARTIFACT_BOUNDARY);
    await fs.rm(path.join(directory, 'extra'));
    await fs.mkdir(path.join(directory, 'unlisted'));
    await verifyError(directory, expected, AGENT_ERROR.ARTIFACT_BOUNDARY);
  });

  it.each([
    '/absolute', 'C:/drive', 'C:\\drive', 'back\\slash', '../parent', 'a/../parent',
    'CON', 'nested/NUL.txt', 'LPT1.log', 'trailing.', 'trailing ', 'bad:name',
  ])('rejects unsafe manifest path %s', (name) => invalidFiles([record(name, Buffer.alloc(0))]));

  it('rejects case-insensitive duplicate paths and malformed or tampered manifest digests', async () => {
    const files = [record('Readme', Buffer.from('a')), record('README', Buffer.from('b'))];
    invalidFiles(files);
    const directory = await makeRoot();
    const validFiles = [record('file', Buffer.from('x'))];
    const expected = manifest(validFiles);
    await fs.writeFile(path.join(directory, 'file'), 'x');
    await verifyError(directory, { ...expected, artifactDigest: '0'.repeat(64) }, AGENT_ERROR.ARTIFACT_MISMATCH);
    await verifyError(directory, { ...expected, artifactDigest: 'invalid' }, AGENT_ERROR.INVALID_INPUT);
    await expect(verifyAgentArtifacts({ directory: '', manifest: expected }))
      .rejects.toMatchObject({ code: AGENT_ERROR.INVALID_INPUT });
  });

  it('enforces file count, per-file, and total byte limits', () => {
    const empty = Buffer.alloc(0);
    const many = Array.from({ length: AGENT_ARTIFACT.MAX_FILES + 1 }, (_, index) => record(`f${index}`, empty));
    invalidFiles(many);
    invalidFiles([{ path: 'large', bytes: AGENT_ARTIFACT.MAX_FILE_BYTES + 1, digest: '0'.repeat(64) }]);
    const total = Array.from({ length: AGENT_ARTIFACT.MAX_FILES }, (_, index) => ({
      path: `f${index}`, bytes: AGENT_ARTIFACT.MAX_FILE_BYTES, digest: '0'.repeat(64),
    }));
    invalidFiles(total);
  });

  it('rejects child links and a linked verification root without following them', async ({ skip }) => {
    const directory = await makeRoot();
    const outside = await makeRoot();
    await fs.writeFile(path.join(outside, 'secret'), 'outside-secret');
    const expected = manifest([record('link/secret', Buffer.from('outside-secret'))]);
    try {
      await fs.symlink(outside, path.join(directory, 'link'), 'junction');
    } catch (error) {
      if (unavailablePrivilege(error)) skip(`native directory link unavailable: ${error.code}`);
      throw error;
    }
    await verifyError(directory, expected, AGENT_ERROR.ARTIFACT_BOUNDARY);
    const linkedRoot = path.join(await makeRoot(), 'root-link');
    try {
      await fs.symlink(directory, linkedRoot, 'junction');
    } catch (error) {
      if (unavailablePrivilege(error)) skip(`native directory link unavailable: ${error.code}`);
      throw error;
    }
    await verifyError(linkedRoot, expected, AGENT_ERROR.ARTIFACT_BOUNDARY);
  });

  it('returns fixed errors without exposing paths or file contents', async () => {
    const directory = await makeRoot();
    const secret = 'sensitive-file-content';
    const expected = manifest([record('private/name.txt', Buffer.from(secret))]);
    const error = await verifyAgentArtifacts({ directory, manifest: expected }).catch((value) => value);
    expect(error).toBeInstanceOf(AgentArtifactError);
    expect(error).toMatchObject({ code: AGENT_ERROR.ARTIFACT_UNAVAILABLE });
    expect(error.message).toBe(`Agent artifact refused: ${AGENT_ERROR.ARTIFACT_UNAVAILABLE}`);
    expect(`${error.stack}`).not.toContain(directory);
    expect(`${error.stack}`).not.toContain(secret);
  });
});
