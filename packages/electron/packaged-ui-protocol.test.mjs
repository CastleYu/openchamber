import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackagedUiHandler } from './packaged-ui-protocol.mjs';

test('serves real documents and assets; reports missing resources and recovers after restoration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oc-ui-test-'));
  const errors = [];
  const handler = createPackagedUiHandler({
    getDistPath: () => dir,
    injectHtml: (html) => html + '<!-- runtime -->',
    fetchFile: async (url) => new Response(await readFile(fileURLToPath(url))),
    log: { error: (...args) => errors.push(args) },
  });
  const request = (suffix, mode = 'cors') => handler({ url: 'openchamber-ui://app/' + suffix, mode });
  try {
    await writeFile(path.join(dir, 'index.html'), '<html>main</html>');
    await writeFile(path.join(dir, 'mini-chat.html'), '<html>mini</html>');
    await mkdir(path.join(dir, 'assets'));
    await writeFile(path.join(dir, 'assets/app.js'), 'export default 1;');
    assert.match(await (await request('index.html?session=keep')).text(), /main.*runtime/);
    assert.match(await (await request('mini-chat.html')).text(), /mini.*runtime/);
    assert.match(await (await request('session/one', 'navigate')).text(), /main/);
    assert.equal(await (await request('assets/app.js')).text(), 'export default 1;');
    for (const suffix of ['assets/missing.js', 'missing.png', 'missing.mp4']) {
      const response = await request(suffix);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '');
    }
    for (const suffix of ['%ZZ', '%00', '%2e%2e%5csecret', 'C%3A/secret']) {
      assert.equal((await request(suffix)).status, 400);
    }
    await rm(path.join(dir, 'index.html'));
    const response = await request('index.html?session=keep');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await response.text();
    assert.match(html, /Application files are missing/);
    assert.doesNotMatch(html, /<script|runtime|session=keep/);
    assert.equal(errors.length, 1);
    assert.doesNotMatch(JSON.stringify(errors), /oc-ui-test-/);
    await writeFile(path.join(dir, 'index.html'), '<html>restored</html>');
    assert.match(await (await request('index.html')).text(), /restored/);
    await rm(path.join(dir, 'mini-chat.html'));
    assert.equal((await request('mini-chat.html')).status, 503);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
