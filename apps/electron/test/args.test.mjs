import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCoreArgs } from '../dist/main/args.js';

test('parseCoreArgs collects --core in both forms', () => {
  assert.deepEqual(
    parseCoreArgs(['app', '--core', 'http://a', '--core=http://b']),
    ['http://a', 'http://b'],
  );
});

test('parseCoreArgs falls back to PLUGUMI_CORE_URL only when no flag is given', () => {
  const previous = process.env.PLUGUMI_CORE_URL;
  process.env.PLUGUMI_CORE_URL = 'http://env';
  try {
    assert.deepEqual(parseCoreArgs([]), ['http://env']);
    assert.deepEqual(parseCoreArgs(['--core', 'http://flag']), ['http://flag']);
  } finally {
    if (previous === undefined) delete process.env.PLUGUMI_CORE_URL;
    else process.env.PLUGUMI_CORE_URL = previous;
  }
});

test('parseCoreArgs throws on a dangling --core', () => {
  assert.throws(() => parseCoreArgs(['--core']), /missing value/);
});
