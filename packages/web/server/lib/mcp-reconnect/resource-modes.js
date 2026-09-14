import { createHash } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';
import { z } from 'zod';
import express from 'express';

const LeaseMs = 90_000;
const route = '/api/system/project-resources';
const snapshotSchema = z.object({
  client: z.string().uuid(), revision: z.number().int().nonnegative(),
  directories: z.array(z.object({ directory: z.string().min(1).max(4096), mode: z.enum(['idle', 'background', 'focused']) })).max(1000),
});

// Also serialized into the managed OpenCode plugin.
export function resourceKey(directory) {
  return directory.trim().replace(/\\/g, '/').replace(/^([a-z]):/, (_, drive) => drive.toUpperCase() + ':').replace(/\/+$/, '') || '/';
}

export function createResourceModes() {
  const clients = new Map();
  let file = null;
  let pending = Promise.resolve();
  const serialize = (work) => {
    const next = pending.then(work);
    pending = next.catch(() => {});
    return next;
  };
  return {
    start(target) {
      return serialize(async () => {
        file = target;
        clients.clear();
        await writeFile(file, '[]', { mode: 0o600 });
      });
    },
    publish(snapshot) {
      return serialize(async () => {
        if (!file) return false;
        const now = Date.now();
        for (const [id, entry] of clients) if (entry.expires <= now) clients.delete(id);
        if ((clients.get(snapshot.client)?.revision ?? -1) >= snapshot.revision) return true;
        clients.set(snapshot.client, { revision: snapshot.revision, expires: now + LeaseMs, directories: snapshot.directories });
        const entries = new Map();
        for (const client of clients.values()) for (const entry of client.directories) {
          const key = createHash('sha256').update(resourceKey(entry.directory)).digest('hex');
          const previous = entries.get(key) ?? { key, idleUntil: 0, activeUntil: 0 };
          if (entry.mode === 'idle') previous.idleUntil = Math.max(previous.idleUntil, client.expires);
          else previous.activeUntil = Math.max(previous.activeUntil, client.expires);
          entries.set(key, previous);
        }
        const temporary = `${file}.tmp`;
        await writeFile(temporary, JSON.stringify([...entries.values()]), { mode: 0o600 });
        await rename(temporary, file);
        return true;
      });
    },
  };
}

export const resourceModes = createResourceModes();

export function registerResourceModeRoutes(app) {
  app.post(route, express.json({ limit: '1mb' }), async (req, res) => {
    const parsed = snapshotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid resource snapshot' });
    try {
      const supported = await resourceModes.publish(parsed.data);
      res.status(supported ? 200 : 501).json({ supported });
    } catch {
      console.warn('[mcp-idle]', JSON.stringify({ event: 'mode-write-failed' }));
      res.status(503).json({ error: 'Resource state unavailable' });
    }
  });
}
