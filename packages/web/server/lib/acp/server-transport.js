import { connect } from 'node:http2';
import WebSocket from 'ws';
import { z } from 'zod';
import { METHOD } from './protocol.js';
import { absoluteDirectorySchema, projectMappingsSchema } from './project-mapping.js';

export const ACP_SERVER_MODE = 'acp-server';
export const serverSchema = z.object({
  mode: z.literal(ACP_SERVER_MODE),
  transport: z.enum(['websocket', 'http']),
  url: z.url(),
  cwd: absoluteDirectorySchema,
  projectMappings: projectMappingsSchema.optional(),
}).superRefine((value, ctx) => {
  const url = new URL(value.url);
  const protocols = value.transport === 'websocket' ? ['ws:', 'wss:'] : ['http:', 'https:'];
  if (!protocols.includes(url.protocol) || url.username || url.password || url.hash) ctx.addIssue({ code: 'custom', message: 'Enter a matching ACP server URL without credentials or a fragment', path: ['url'] });
});
const HEADER = Object.freeze({ CONNECTION: 'acp-connection-id', SESSION: 'acp-session-id', TYPE: 'content-type', ACCEPT: 'accept' });
const MIME = Object.freeze({ JSON: 'application/json', SSE: 'text/event-stream' });
const sessionSchema = z.object({ params: z.object({ sessionId: z.string().optional() }).passthrough().optional(), result: z.object({ sessionId: z.string().optional() }).passthrough().optional() }).passthrough();
const sessionId = (value) => { const parsed = sessionSchema.safeParse(value); return parsed.success ? parsed.data.params?.sessionId ?? parsed.data.result?.sessionId : undefined; };

/** Owns only the selected outbound connection, never the remote agent process. */
export const openServerTransport = async (config, receive, fail) => {
  if (config.transport === 'websocket') {
    const socket = new WebSocket(config.url, { handshakeTimeout: 30000 });
    let stopped = false;
    socket.on('message', (data, binary) => {
      if (stopped) return;
      if (binary) { fail(new Error('ACP WebSocket requires JSON text frames')); socket.close(); return; }
      try { receive(data.toString()); } catch (error) { fail(error); socket.close(); }
    });
    socket.on('error', (error) => { if (!stopped) fail(error); });
    socket.on('close', () => { if (!stopped) fail(new Error('ACP server disconnected')); });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return {
      send: (value) => new Promise((resolve, reject) => socket.send(JSON.stringify(value), (error) => error ? reject(error) : resolve())),
      close: () => { stopped = true; socket.terminate(); },
    };
  }
  const url = new URL(config.url);
  const client = connect(url.origin);
  let stopped = false;
  let connectionId;
  const streams = new Set();
  const sessions = new Set();
  let incoming = Promise.resolve();
  const replies = new Map();
  const loads = new Map();
  client.on('error', (error) => { if (!stopped) fail(error); });
  client.on('close', () => { if (!stopped) fail(new Error('ACP HTTP/2 connection closed')); });
  const request = (method, headers = {}) => client.request({ ':method': method, ':path': `${url.pathname}${url.search}`, ...headers });
  const openStream = (id) => new Promise((resolve, reject) => {
    const headers = { [HEADER.ACCEPT]: MIME.SSE, [HEADER.CONNECTION]: connectionId };
    if (id) headers[HEADER.SESSION] = id;
    const stream = request('GET', headers);
    streams.add(stream);
    let buffer = '';
    stream.setEncoding('utf8');
    stream.once('response', (headers) => {
      if (headers[':status'] !== 200 || !String(headers[HEADER.TYPE] ?? '').startsWith(MIME.SSE)) { reject(new Error(`ACP SSE failed (${headers[':status']})`)); stream.close(); return; }
      resolve();
    });
    stream.on('data', (chunk) => {
      buffer = (buffer + chunk).replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = event.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        try {
          const value = JSON.parse(data);
          const next = sessionId(value) ?? (value.result !== undefined ? loads.get(value.id) : undefined);
          if (!value.method) loads.delete(value.id);
          if (value.id !== undefined && value.method && next) replies.set(value.id, next);
          incoming = incoming.then(async () => {
            if (next && !sessions.has(next)) { sessions.add(next); await openStream(next); }
            receive(data);
          }).catch(fail);
        } catch (error) { fail(new Error(`Invalid ACP SSE message: ${error.message}`)); }
      }
    });
    stream.on('error', (error) => { reject(error); if (!stopped) fail(error); });
    stream.on('close', () => { streams.delete(stream); if (!stopped) fail(new Error('ACP SSE stream closed')); });
    stream.end();
  });
  const post = (value) => new Promise((resolve, reject) => {
    const initialize = value.method === METHOD.INITIALIZE;
    const id = sessionId(value) ?? replies.get(value.id);
    const load = value.method === METHOD.LOAD || value.method === METHOD.RESUME;
    if (load) loads.set(value.id, id);
    const headers = { [HEADER.TYPE]: MIME.JSON };
    if (connectionId) headers[HEADER.CONNECTION] = connectionId;
    if (id && !load) headers[HEADER.SESSION] = id;
    const stream = request('POST', headers);
    let response;
    let body = '';
    stream.setTimeout(30000, () => { reject(new Error('ACP HTTP POST timed out')); stream.close(); });
    stream.setEncoding('utf8');
    stream.on('response', (headers) => { response = headers; });
    stream.on('data', (chunk) => { body += chunk; });
    stream.on('error', reject);
    stream.on('aborted', () => reject(new Error('ACP HTTP POST aborted')));
    stream.on('end', () => {
      if (response?.[':status'] !== (initialize ? 200 : 202)) { reject(new Error(`ACP POST failed (${response?.[':status']})`)); return; }
      if (!initialize) { replies.delete(value.id); resolve(); return; }
      connectionId = response[HEADER.CONNECTION];
      if (!connectionId) { reject(new Error('ACP initialize omitted Acp-Connection-Id')); return; }
      void openStream().then(() => { receive(body); resolve(); }).catch(reject);
    });
    stream.end(JSON.stringify(value));
  });
  return {
    send: post,
    close: async () => {
      stopped = true;
      for (const stream of streams) stream.close();
      try {
        if (connectionId && !client.destroyed) await new Promise((resolve) => {
          const stream = request('DELETE', { [HEADER.CONNECTION]: connectionId });
          const timer = setTimeout(() => { stream.close(); resolve(); }, 3000);
          stream.on('data', () => {});
          const done = () => { clearTimeout(timer); resolve(); };
          stream.on('end', done); stream.on('error', done); stream.end();
        });
      } finally { client.destroy(); }
    },
  };
};
