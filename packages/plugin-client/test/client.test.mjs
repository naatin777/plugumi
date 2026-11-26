import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreURL } from '../dist/client.js';

test('coreURL accepts bare HTTP(S) origins', () => {
  assert.equal(coreURL('http://127.0.0.1:7700').hostname, '127.0.0.1');
  assert.equal(coreURL('http://localhost').protocol, 'http:');
});

test('coreURL rejects non-origin URLs', () => {
  for (const invalid of [
    'http://user@localhost:7700',
    'http://localhost:7700/path',
    'http://localhost:7700/?q=1',
    'http://localhost:7700/#frag',
    'ftp://localhost',
  ]) {
    assert.throws(() => coreURL(invalid), /origin/, invalid);
  }
});
