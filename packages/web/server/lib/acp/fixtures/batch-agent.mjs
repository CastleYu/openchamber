import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
const pidFile = process.argv.indexOf('--pid-file');
if (pidFile >= 0) writeFileSync(process.argv[pidFile + 1], JSON.stringify({ pid: process.pid, descendant: descendant.pid }));
process.stderr.write('fixture diagnostic\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (process.argv.includes('--malformed')) { process.stdout.write('not JSON\n'); return; }
  const result = request.method === 'initialize'
    ? { protocolVersion: 1, agentInfo: { name: 'batch-fixture', version: JSON.stringify({ pid: process.pid, descendant: descendant.pid, args: process.argv.slice(2) }) }, agentCapabilities: {}, authMethods: [] }
    : { sessionId: 'batch-session' };
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});
