import { spawn } from 'node:child_process';

// An accepted OS spawn is the handoff boundary; the application owns its UI
// and lifetime. Keep an error listener until exit, even after handoff.
export const launchNativeApp = (program, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(program, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    ...options,
  });
  child.once('error', reject);
  child.once('spawn', () => {
    child.unref();
    resolve();
  });
});
