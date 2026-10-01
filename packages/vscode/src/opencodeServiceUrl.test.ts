import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isSameOpenCodeServer } from './opencodeServiceUrl';

describe('OpenCode service URL identity', () => {
  it('accepts equivalent loopback names at the same scheme and port', () => {
    assert.equal(isSameOpenCodeServer('http://localhost:4096', 'http://127.0.0.1:4096'), true);
    assert.equal(isSameOpenCodeServer('http://[::1]:4096', 'http://127.0.0.1:4096'), true);
  });
  it('refuses other destinations or malformed URLs', () => {
    assert.equal(isSameOpenCodeServer('http://localhost:4096', 'http://other.test:4096'), false);
    assert.equal(isSameOpenCodeServer('http://localhost:4096', 'https://localhost:4096'), false);
    assert.equal(isSameOpenCodeServer('http://localhost:4096', 'http://localhost:4097'), false);
    assert.equal(isSameOpenCodeServer('not a URL', 'http://localhost:4096'), false);
  });
});
