import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PERMISSION_MODES } from './modes.js';

const FILE_NAME = 'permission-modes.json';
const fileSchema = z.object({
  version: z.literal(1),
  sessions: z.record(z.string().min(1), z.enum(PERMISSION_MODES)),
  revision: z.number().int().nonnegative(),
}).strict();

export const createPermissionModesStore = ({ dataDir }) => {
  const file = path.join(dataDir, FILE_NAME);
  return {
    read: async () => {
      let raw;
      try { raw = await fs.readFile(file, 'utf8'); }
      catch (error) {
        if (error?.code === 'ENOENT') return { sessions: {}, revision: 0 };
        throw error;
      }
      const parsed = fileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error(`Invalid ${FILE_NAME}: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`);
      return { sessions: parsed.data.sessions, revision: parsed.data.revision };
    },
    write: async (policy) => {
      const parsed = fileSchema.parse({ version: 1, ...policy });
      await fs.mkdir(dataDir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
      try {
        await fs.writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tmp, file);
        if (process.platform !== 'win32') await fs.chmod(file, 0o600);
      } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw error;
      }
    },
  };
};
