import { randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { spawnAcp, terminateAcp } from './process.js';

export const CALLBACK = Object.freeze({
  READ: 'fs/read_text_file', WRITE: 'fs/write_text_file', CREATE: 'terminal/create',
  OUTPUT: 'terminal/output', WAIT: 'terminal/wait_for_exit', KILL: 'terminal/kill', RELEASE: 'terminal/release',
});
const LIMIT = Object.freeze({ OUTPUT: 1024 * 1024, KILL_MS: 1000, CLOSE_MS: 5000 });
const text = z.string().min(1).refine((value) => !value.includes('\0'));
const session = z.object({ sessionId: text });
const file = session.extend({ path: text.refine(isAbsolute, 'Path must be absolute') });
const terminal = session.extend({ terminalId: text });
const schemas = new Map([
  [CALLBACK.READ, file.extend({ line: z.number().int().positive().optional(), limit: z.number().int().nonnegative().optional() })],
  [CALLBACK.WRITE, file.extend({ content: z.string() })],
  [CALLBACK.CREATE, session.extend({ command: text, args: z.array(z.string().refine((value) => !value.includes('\0'))).default([]), cwd: text.refine(isAbsolute).optional(), env: z.array(z.object({ name: text.refine((value) => !value.includes('=')), value: z.string().refine((value) => !value.includes('\0')) })).default([]), outputByteLimit: z.number().int().nonnegative().default(LIMIT.OUTPUT) })],
  ...[CALLBACK.OUTPUT, CALLBACK.WAIT, CALLBACK.KILL, CALLBACK.RELEASE].map((method) => [method, terminal]),
]);
const within = (root, target) => {
  const tail = relative(root, target);
  if (tail === '..' || tail.startsWith(`..${sep}`) || isAbsolute(tail)) throw new Error('ACP path is outside the session directory');
  return target;
};

/** Local stdio only. The runtime supplies each session's immutable agent cwd. */
export const createAcpCallbacks = ({ directory, onOutput = () => {} }) => {
  const terminals = new Map();
  const released = new Map();
  const pending = new Map();
  const stopping = new Set();
  let closed = false;

  const rootFor = async (id) => {
    if (closed || stopping.has(id)) throw new Error('ACP callbacks are stopping');
    const root = directory(id);
    if (!root || !isAbsolute(root)) throw new Error('Unknown ACP session directory');
    return realpath(root);
  };
  const pathFor = async (id, target, create = false) => {
    const root = await rootFor(id);
    try { return within(root, await realpath(target)); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      // A dangling symlink must not become a newly created out-of-root target.
      try { await lstat(target); throw new Error('ACP write target is an unresolved link'); }
      catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
      return within(root, join(await realpath(dirname(target)), basename(target)));
    }
  };
  const snapshot = (record) => {
    const result = { output: record.output, truncated: record.truncated };
    if (record.exitStatus) result.exitStatus = record.exitStatus;
    return result;
  };
  const publish = (record) => onOutput({ sessionId: record.sessionId, terminalId: record.id, ...snapshot(record) });
  const append = (record, value) => {
    if (!value) return;
    let bytes = Buffer.from(record.output + value);
    if (bytes.length > record.limit) {
      let start = bytes.length - record.limit;
      while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
      bytes = bytes.subarray(start);
      record.truncated = true;
    }
    record.output = bytes.toString('utf8');
    publish(record);
  };
  const signalGroup = (record, signal) => {
    try { process.kill(-record.child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const kill = (record) => {
    if (record.kill) return record.kill;
    record.kill = (async () => {
      if (process.platform === 'win32') {
        await terminateAcp(record.child);
        let timer;
        try {
          await Promise.race([record.done, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('ACP terminal pipes did not close; an exited Windows command may have left a descendant running')), LIMIT.CLOSE_MS);
          })]);
        } finally { clearTimeout(timer); }
        return;
      }
      signalGroup(record, 'SIGTERM');
      const timer = setTimeout(() => signalGroup(record, 'SIGKILL'), LIMIT.KILL_MS);
      try { await record.done; signalGroup(record, 'SIGKILL'); }
      finally { clearTimeout(timer); }
    })();
    return record.kill;
  };
  const create = async (params) => {
    const cwd = await pathFor(params.sessionId, params.cwd ?? await rootFor(params.sessionId));
    if (!(await stat(cwd)).isDirectory()) throw new Error('ACP terminal cwd must be a directory');
    const env = { ...process.env };
    for (const item of params.env) {
      const name = process.platform === 'win32' ? Object.keys(env).find((key) => key.toLowerCase() === item.name.toLowerCase()) ?? item.name : item.name;
      env[name] = item.value;
    }
    delete env.NODE_CHANNEL_FD;
    const child = await spawnAcp({ command: params.command, args: params.args, cwd, env, detached: process.platform !== 'win32' });
    const record = { id: randomUUID(), sessionId: params.sessionId, child, output: '', truncated: false, limit: params.outputByteLimit, exitStatus: null, kill: null, done: null };
    const decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
    child.stdout.on('data', (chunk) => append(record, decoders[0].write(chunk)));
    child.stderr.on('data', (chunk) => append(record, decoders[1].write(chunk)));
    record.done = new Promise((resolve) => child.once('close', (exitCode, signal) => {
      decoders.forEach((decoder) => append(record, decoder.end()));
      record.exitStatus = { exitCode, signal };
      publish(record);
      resolve(record.exitStatus);
    }));
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.stdin.end();
    terminals.set(record.id, record);
    if (closed || stopping.has(params.sessionId)) {
      await kill(record);
      terminals.delete(record.id);
      throw new Error('ACP callbacks stopped during terminal creation');
    }
    return { terminalId: record.id };
  };
  const request = async (method, input) => {
    const schema = schemas.get(method);
    if (!schema) throw new Error('Unsupported ACP client callback');
    const params = schema.parse(input);
    if (method === CALLBACK.CREATE) {
      const task = create(params);
      pending.set(task, params.sessionId);
      try { return await task; } finally { pending.delete(task); }
    }
    await rootFor(params.sessionId);
    if (method === CALLBACK.READ) {
      const content = await readFile(await pathFor(params.sessionId, params.path), 'utf8');
      if (params.line === undefined && params.limit === undefined) return { content };
      const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      const start = (params.line ?? 1) - 1;
      return { content: lines.slice(start, params.limit === undefined ? undefined : start + params.limit).join('') };
    }
    if (method === CALLBACK.WRITE) {
      await writeFile(await pathFor(params.sessionId, params.path, true), params.content, 'utf8');
      return {};
    }
    const record = terminals.get(params.terminalId);
    if (method === CALLBACK.RELEASE && released.get(params.terminalId) === params.sessionId) return {};
    if (!record || record.sessionId !== params.sessionId) throw new Error('Unknown ACP terminal for this session');
    if (method === CALLBACK.OUTPUT) return snapshot(record);
    if (method === CALLBACK.WAIT) return record.done;
    await kill(record);
    if (method === CALLBACK.RELEASE) { terminals.delete(record.id); released.set(record.id, record.sessionId); }
    return {};
  };
  const stop = async (sessionId) => {
    if (sessionId === undefined) closed = true; else stopping.add(sessionId);
    try {
      await Promise.allSettled([...pending].filter(([, id]) => sessionId === undefined || id === sessionId).map(([task]) => task));
      const owned = [...terminals.values()].filter((record) => sessionId === undefined || record.sessionId === sessionId);
      await Promise.all(owned.map(async (record) => { await kill(record); terminals.delete(record.id); }));
      for (const [id, owner] of released) if (sessionId === undefined || owner === sessionId) released.delete(id);
    } finally { if (sessionId !== undefined) stopping.delete(sessionId); }
  };
  return { capabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }, handles: (method) => schemas.has(method), request, stop };
};
