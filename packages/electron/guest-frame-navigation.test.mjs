import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldBlockGuestFrameNavigation } from './guest-frame-navigation.mjs';

const isAppOrigin = (url) => new URL(url).origin === 'http://127.0.0.1:3902';
const guest = (url) => shouldBlockGuestFrameNavigation({ isMainFrame: false, frameOrigin: 'null', url, isAppOrigin });

test('refuses an extension frame leaving for another address', () => {
  for (const url of [
    'https://example.com/?data=conversation',
    'http://127.0.0.1:3902/api/session',
    'http://127.0.0.1:9999/api/guests/demo/index.html',
    'javascript:alert(1)',
    'not a url',
  ]) assert.equal(guest(url), true, url);
});

test('allows only app extension pages and local documents', () => {
  for (const url of [
    'http://127.0.0.1:3902/api/guests/demo/index.html',
    'about:srcdoc',
    'data:text/html,<p>hi</p>',
    'blob:http://127.0.0.1:3902/0f2d',
  ]) assert.equal(guest(url), false, url);
});

test('does not affect main and ordinary origin frames', () => {
  assert.equal(shouldBlockGuestFrameNavigation({ isMainFrame: true, frameOrigin: 'null', url: 'https://example.com/', isAppOrigin }), false);
  assert.equal(shouldBlockGuestFrameNavigation({ isMainFrame: false, frameOrigin: 'https://docs.example', url: 'https://example.com/', isAppOrigin }), false);
});
