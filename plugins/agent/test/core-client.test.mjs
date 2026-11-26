import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { CoreClient, coreURL } from "../dist/core-client.js";

test("Agent registers, reconnects without a listener, and refreshes its Core catalog", async () => {
  const stop = new AbortController();
  const deadline = AbortSignal.timeout(5000);
  const identities = [];
  let renewalRequests = 0;
  let registryRequests = 0;
  let announcedTool = "one";
  let notify;
  let endEvents;
  let delayedSnapshot;
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    switch (`${request.method} ${request.url}`) {
      case "POST /v1/registrations": {
        let body = "";
        for await (const chunk of request) body += chunk;
        identities.push(JSON.parse(body));
        response.end(JSON.stringify({
          coreId: "core-test", registrationId: "registration-test", leaseSeconds: 60, expiresAt: "",
        }));
        break;
      }
      case "POST /v1/registrations/registration-test/renew":
        renewalRequests++;
        response.end("{}");
        break;
      case "PUT /v1/registrations/registration-test/tools":
      case "DELETE /v1/registrations/registration-test":
        response.writeHead(204).end();
        break;
      case "GET /v1/events":
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        notify = (event) => response.write(`event: ${event}\ndata: {}\n\n`);
        endEvents = () => response.end();
        notify("registry.reset");
        break;
      case "GET /v1/registry": {
        registryRequests++;
        const body = JSON.stringify({
          coreId: "core-test", revision: "revision-test",
          registrations: [{ registrationId: "other", providerId: "other-plugin", rpcAvailable: true, tools: [{ toolPath: announcedTool }] }],
        });
        if (registryRequests === 2 || registryRequests === 4) delayedSnapshot = () => response.end(body);
        else response.end(body);
        break;
      }
      default:
        response.writeHead(404).end();
    }
  });
  const websocket = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/v1/rpc?registrationId=registration-test") {
      socket.destroy();
      return;
    }
    websocket.handleUpgrade(request, socket, head, (connection) => {
      websocket.emit("connection", connection);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new CoreClient(coreURL(`http://127.0.0.1:${server.address().port}`), "instance-test");
  const run = client.run(stop.signal);
  const until = async (condition) => {
    while (!condition()) await delay(10, undefined, { signal: deadline });
  };
  try {
    await until(() => client.catalog[0]?.toolPath === "one");
    assert.deepEqual(identities[0], { providerId: "agent", instanceId: "instance-test" });
    announcedTool = "two";
    notify("tools.changed");
    await until(() => delayedSnapshot !== undefined);
    announcedTool = "three";
    notify("tools.changed");
    notify("provider.added");
    notify("provider.changed");
    // 一覧取得を保留している間に通知をまとめて届ける。
    await delay(50);
    assert.equal(registryRequests, 2, "only one snapshot request may be in flight");
    delayedSnapshot();
    await until(() => client.catalog[0]?.toolPath === "three");
    await delay(50);
    assert.equal(registryRequests, 3, "changes during the request need only one follow-up snapshot");

    delayedSnapshot = undefined;
    announcedTool = "stale";
    notify("tools.changed");
    await until(() => delayedSnapshot !== undefined);
    announcedTool = "two";
    endEvents();
    await until(() => client.catalog.length === 0);
    delayedSnapshot();
    await until(() => client.catalog[0]?.toolPath === "two");
    assert.equal(identities.length, 1, "ending SSE should not reopen RPC");

    for (const connection of websocket.clients) connection.terminate();
    await until(() => identities.length === 2 && client.catalog[0]?.toolPath === "two");
    assert.deepEqual(identities[1], identities[0]);
    assert.equal(renewalRequests, 0, "registration already starts a fresh lease");
  } finally {
    stop.abort();
    await run;
    websocket.close();
    server.closeAllConnections();
    server.close();
  }
});
