import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connection } from '../dist/rpc.js';

function setup() {
  const socket = {
    send(data) { this.sent = JSON.parse(data); },
    close() { this.closed(); },
    onMessage(listener) { this.message = listener; },
    onClose(listener) { this.closed = listener; },
  };
  return { socket, connection: Connection.attach(socket) };
}

test('timeout removes the pending request and ignores a late response', async () => {
  const { socket, connection } = setup();
  const request = connection.request('test', {}, 5);
  await assert.rejects(request, /request timed out/);
  assert.equal(connection.pending.size, 0);
  socket.message(JSON.stringify({ jsonrpc: '2.0', id: socket.sent.id, result: true }));
  assert.equal(connection.pending.size, 0);
});

test('response and connection close clear pending requests and their timers', async () => {
  const { socket, connection } = setup();
  const request = connection.request('test', {}, 10_000);
  socket.message(JSON.stringify({ jsonrpc: '2.0', id: socket.sent.id, result: true }));
  assert.equal((await request).result, true);
  const closing = connection.request('test', {}, 10_000);
  socket.close();
  await assert.rejects(closing, /connection closed/);
  assert.equal(connection.pending.size, 0);
});
