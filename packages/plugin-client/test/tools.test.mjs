import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchToolCall, toolDeclarations } from '../dist/tools.js';

const echoTool = {
  declaration: { toolPath: 'echo', kind: 'sync' },
  handler: async (input) => input,
};

function call(method, params) {
  return { jsonrpc: '2.0', id: 'x-1', method, params };
}

test('toolDeclarations returns declarations only', () => {
  assert.deepEqual(toolDeclarations([echoTool]), [{ toolPath: 'echo', kind: 'sync' }]);
});

test('dispatch routes tools.call to the matching handler with input', async () => {
  const dispatch = dispatchToolCall([echoTool]);
  const response = await dispatch(call('tools.call', { toolPath: 'echo', input: { text: 'hi' } }));
  assert.deepEqual(response, { result: { text: 'hi' } });
});

test('unknown method and toolPath follow the contract error codes', async () => {
  const dispatch = dispatchToolCall([echoTool]);
  assert.equal((await dispatch(call('tools.other', {}))).error.code, -32601);
  assert.equal((await dispatch(call('tools.call', { toolPath: 'nope' }))).error.code, -32601);
  assert.equal((await dispatch(call('tools.call', { toolPath: '' }))).error.code, -32602);
  assert.equal((await dispatch(call('tools.call', null))).error.code, -32602);
});

test('handler failure becomes -32000 instead of throwing', async () => {
  const failing = {
    declaration: { toolPath: 'fail', kind: 'sync' },
    handler: () => { throw new Error('boom'); },
  };
  const response = await dispatchToolCall([failing])(call('tools.call', { toolPath: 'fail' }));
  assert.equal(response.error.code, -32000);
  assert.match(response.error.message, /boom/);
});
