import { open } from 'node:fs/promises';

const ZIP = { end: 0x06054b50, entry: 0x02014b50, tail: 65557, maxDirectory: 16 * 1024 * 1024, maxEntries: 10000 };

// Read only the central directory. No member is inflated or written to disk.
export async function readZipDirectory(file) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const tail = Buffer.alloc(Math.min(size, ZIP.tail));
    await handle.read(tail, 0, tail.length, size - tail.length);
    let end = tail.length - 22;
    while (end >= 0 && (tail.readUInt32LE(end) !== ZIP.end || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) end--;
    if (end < 0) throw new Error('Invalid ZIP directory');
    const count = tail.readUInt16LE(end + 10);
    const length = tail.readUInt32LE(end + 12);
    const offset = tail.readUInt32LE(end + 16);
    if (tail.readUInt32LE(end + 4) !== 0 || count > ZIP.maxEntries || length > ZIP.maxDirectory || offset + length > size - 22) throw new Error('ZIP64, split or oversized ZIP directory is not supported');
    const directory = Buffer.alloc(length);
    const { bytesRead } = await handle.read(directory, 0, length, offset);
    if (bytesRead !== length) throw new Error('Incomplete ZIP directory');
    const entries = [];
    let pos = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > length || directory.readUInt32LE(pos) !== ZIP.entry) throw new Error('Invalid ZIP entry');
      const nameLength = directory.readUInt16LE(pos + 28);
      const end = pos + 46 + nameLength;
      const next = end + directory.readUInt16LE(pos + 30) + directory.readUInt16LE(pos + 32);
      if (next > length) throw new Error('Truncated ZIP entry');
      const name = directory.subarray(pos + 46, end).toString('utf8');
      entries.push({ name, size: directory.readUInt32LE(pos + 24), compressedSize: directory.readUInt32LE(pos + 20), directory: name.endsWith('/') });
      pos = next;
    }
    return entries;
  } finally { await handle.close(); }
}
