import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('REST requests validate JSON before changing Link state', async (t) => {
  const entry = fileURLToPath(new URL('../dist/main.js', import.meta.url));
  const agent = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    if (agent.exitCode === null && agent.signalCode === null) {
      const exited = once(agent, 'exit');
      agent.kill();
      await exited;
    }
  });
  const lines = createInterface({ input: agent.stdout });
  const [startup] = await once(lines, 'line', { signal: AbortSignal.timeout(5000) });
  const endpoint = /^\[agent\] listening on (http:\/\/\S+)$/.exec(startup)?.[1];
  assert.ok(endpoint, startup);

  async function post(path, body) {
    return fetch(endpoint + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  }

  async function expectError(path, body, status, code) {
    const response = await post(path, body);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }

  const linkId = 'link-00000000-0000-4000-8000-000000000001';
  const hello = '/v1/link/hello';
  const ping = '/v1/link/ping';
  const catalog = '/v1/tools/catalog';

  await expectError(hello, '{', 400, 'invalid_params');
  await expectError(hello, { linkId: 123, core: { id: 'core-1' } }, 400, 'invalid_params');
  await expectError(hello, { linkId, core: { id: 123 } }, 400, 'invalid_params');
  const connected = await post(hello, { linkId, core: { id: 'core-1', extra: true } });
  assert.equal(connected.status, 200);
  assert.equal((await connected.json()).plugin.id, 'agent');
  await expectError(hello, { linkId, core: { id: 'core-1', version: 1 } }, 400, 'invalid_params');

  await expectError(ping, {}, 400, 'invalid_params');
  await expectError(ping, { linkId: 'unknown' }, 404, 'unknown_link');
  const alive = await post(ping, { linkId });
  assert.equal(alive.status, 200);
  assert.deepEqual(await alive.json(), {});

  await expectError(catalog, { linkId, tools: [{ linkId, toolPath: 'echo', kind: 'other' }] }, 400, 'invalid_params');
  await expectError(catalog, { linkId, tools: [{ linkId, toolPath: 'echo', tags: [1] }] }, 400, 'invalid_params');
  await expectError(catalog, { linkId: 'unknown', tools: [] }, 404, 'unknown_link');
  for (const tools of [[], [{ linkId, toolPath: 'echo', inputSchema: { type: 'string' }, extra: true }]]) {
    const response = await post(catalog, { linkId, tools });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
  }
});
