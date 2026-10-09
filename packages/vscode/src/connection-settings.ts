import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { OPENCODE_CONNECTION, parseOpenCodeConnection, type ConnectionRecord } from '../../web/server/lib/opencode/connection.js';

const settingsSchema = z.record(z.string(), z.json());
const missingSchema = z.object({ code: z.literal('ENOENT') });
let pendingWrite: Promise<void> = Promise.resolve();

// Shared by connection commits and ordinary settings writes in this extension host.
export const serializeSettingsWrite = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pendingWrite.then(operation);
  pendingWrite = result.then(() => {}, () => {});
  return result;
};

export const writeSettingsAtomic = async (file: string, text: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.promises.writeFile(tmp, text, 'utf8');
    await fs.promises.rename(tmp, file);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
};

export const createConnectionSettings = (file: string) => {
  const read = () => {
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (missingSchema.safeParse(error).success) return {}; throw error; }
    return settingsSchema.parse(JSON.parse(text));
  };
  const backup = path.join(path.dirname(file), OPENCODE_CONNECTION.BACKUP);
  const previous = async () => {
    let text: string;
    try { text = await fs.promises.readFile(backup, 'utf8'); }
    catch (error) { if (missingSchema.safeParse(error).success) return null; throw error; }
    const document = z.strictObject({ connection: z.json() }).parse(JSON.parse(text));
    return parseOpenCodeConnection(document.connection);
  };
  const save = (value: ConnectionRecord) => serializeSettingsWrite(async () => {
    const record = parseOpenCodeConnection(value);
    if (!record) throw new Error('A confirmed connection is required');
    const current = read();
    const prior = parseOpenCodeConnection(current[OPENCODE_CONNECTION.SETTING] ?? null);
    await writeSettingsAtomic(backup, JSON.stringify({ connection: prior }, null, 2));
    await writeSettingsAtomic(file, JSON.stringify({ ...current, [OPENCODE_CONNECTION.SETTING]: record }, null, 2));
  });
  return { read, previous, save };
};

export const connectionSettings = createConnectionSettings(path.join(os.homedir(), '.config', 'openchamber', 'settings.json'));
