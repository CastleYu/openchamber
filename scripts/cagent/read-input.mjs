import fs from 'node:fs/promises';

export const LOCAL_INPUT = Object.freeze({ MAX_BYTES: 1048576, ERROR: 'local-input-unavailable' });

/** Captures bounded local JSON without logging paths, documents or raw exceptions. */
export async function readLocalJSON(name) {
  const handle = await fs.open(name, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > LOCAL_INPUT.MAX_BYTES) throw new Error(LOCAL_INPUT.ERROR);
    const bytes = Buffer.alloc(LOCAL_INPUT.MAX_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await handle.read(bytes, count, bytes.length - count, null);
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    if (count > LOCAL_INPUT.MAX_BYTES) throw new Error(LOCAL_INPUT.ERROR);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)));
  } finally {
    await handle.close();
  }
}
