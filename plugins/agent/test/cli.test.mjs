import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

for (const phase of ["registration", "WebSocket upgrade"]) {
  test(`Agent exits unsuccessfully without retrying a rejected ${phase}`, async (t) => {
    const cache = await mkdtemp(join(tmpdir(), "plugumi-agent-cli-"));
    t.after(() => rm(cache, { recursive: true, force: true }));
    const env = { ...process.env, HOME: cache, XDG_CACHE_HOME: cache, LOCALAPPDATA: cache, PLUGUMI_TOKEN: "" };
    let registrations = 0;
    let upgrades = 0;
    const server = createServer((request, response) => {
      if (request.url === "/v1/registrations") {
        registrations++;
        if (phase === "registration") {
          response.writeHead(401).end();
        } else {
          response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({
            coreId: "core-test", registrationId: "registration-test", leaseSeconds: 60, expiresAt: "",
          }));
        }
      } else {
        response.writeHead(204).end();
      }
    });
    server.on("upgrade", (_request, socket) => {
      upgrades++;
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    });
    server.listen(0, "127.0.0.1");
    t.after(() => server.close());
    await once(server, "listening");

    await assert.rejects(
      run(process.execPath, [cli, "--core", `http://127.0.0.1:${server.address().port}`], { env, timeout: 3_000 }),
      { code: 1, stderr: /HTTP (401|403)\b/ },
    );
    assert.equal(registrations, 1);
    assert.equal(upgrades, phase === "registration" ? 0 : 1);
  });
}
