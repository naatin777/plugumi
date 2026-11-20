import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { startCommandLoop } from "../dist/command-loop.js";
import { Connection } from "../dist/rpc.js";

function fakeCore(port) {
  const sent = [];
  let receive;
  let disconnected;
  const connection = Connection.attach({
    onMessage(listener) { receive = listener; },
    onClose(listener) { disconnected = listener; },
    close() { disconnected(); },
    send(data) {
      const message = JSON.parse(data);
      sent.push(message);
      if (message.method === "tools.call") {
        receive(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { accepted: true } }));
      }
    },
  });
  return { url: new URL(`http://127.0.0.1:${port}`), connection, sent };
}

test("close uses the call's original connection, not the selected Core or a replacement connection", async (t) => {
  const first = fakeCore(7700);
  const second = fakeCore(7701);
  const input = new PassThrough();
  const cli = startCommandLoop([first, second], input);
  t.after(() => { cli.close(); input.destroy(); });

  input.write("call first ticks\ncore 2\ncall second ticks\n");
  await setImmediate();
  const firstId = first.sent[0].id;
  const secondId = second.sent[0].id;
  input.write(`close ${firstId}\n`);
  await setImmediate();
  assert.equal(first.sent[1]?.method, "tools.call.close");
  assert.deepEqual(first.sent[1].params, { callId: firstId });
  assert.equal(second.sent.length, 1, "the selected Core must not receive another Core's cancellation");

  second.connection.close();
  const replacement = fakeCore(7701);
  second.connection = replacement.connection;
  input.write("call replacement ticks\n");
  await setImmediate();
  input.write(`close ${secondId}\n`);
  await setImmediate();
  assert.equal(replacement.sent.length, 1, "a closed session's call ID must not cancel a new call");
});
