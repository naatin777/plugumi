import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { on, once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const coreBinary = process.env.PLUGUMI_TEST_CORE;
const standardBinary = process.env.PLUGUMI_TEST_STANDARD;

test("both Plugin clients recover independently after one Core restarts", {
  skip: !coreBinary || !standardBinary ? "set PLUGUMI_TEST_CORE and PLUGUMI_TEST_STANDARD to built binaries" : false,
  timeout: 30_000,
}, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "plugumi-test-"));
  const processes = [];
  const sockets = [];
  const deadline = AbortSignal.any([t.signal, AbortSignal.timeout(20_000)]);
  const token = "integration-test";
  const env = {
    ...process.env, HOME: directory, USERPROFILE: directory, XDG_CACHE_HOME: directory,
    LOCALAPPDATA: directory, PLUGUMI_TOKEN: token,
  };
  const headers = { Authorization: `Bearer ${token}` };
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    try {
      await Promise.all(processes.map(stop));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  function start(file, args, overrides = {}) {
    const child = spawn(file, args, {
      cwd: directory, env: { ...env, ...overrides }, stdio: ["ignore", "ignore", "ignore"],
    });
    const closed = once(child, "close");
    closed.catch(() => {});
    const process = { child, closed };
    processes.push(process);
    return process;
  }
  async function stop({ child, closed }) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const fallback = setTimeout(() => child.kill("SIGKILL"), 2000);
      try {
        await closed;
      } finally {
        clearTimeout(fallback);
      }
    } else {
      await closed;
    }
  }
  async function eventually(read) {
    for (;;) {
      deadline.throwIfAborted();
      const value = await read();
      if (value) return value;
      await delay(25, undefined, { signal: deadline });
    }
  }
  async function startCore(name, port = "0") {
    const reportPath = join(directory, name + ".json");
    const process = start(coreBinary, ["serve", "--port", port, "--report-startup"], {
      PLUGUMI_STARTUP_REPORT_FILE: reportPath, PLUGUMI_CORE_LOG_FILE: "",
    });
    const report = await Promise.race([eventually(async () => {
      try {
        return JSON.parse(await readFile(reportPath, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
    }), process.closed.then(([code]) => { throw new Error(`Core exited during startup (${code})`); })]);
    assert.ok(report.url, report.error);
    return { ...process, url: report.url };
  }
  async function registry(core) {
    const response = await fetch(core.url + "/v1/registry", { headers, signal: deadline });
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    const ready = snapshot.registrations.filter(({ rpcAvailable }) => rpcAvailable);
    return ready.length === 2 && {
      coreId: snapshot.coreId,
      registrations: Object.fromEntries(ready.map(({ providerId, registrationId }) => [providerId, registrationId])),
    };
  }
  async function caller(core) {
    const socket = new WebSocket(core.url.replace(/^http:/, "ws:") + "/v1/rpc", { headers });
    sockets.push(socket);
    await once(socket, "open", { signal: deadline });
    const messages = on(socket, "message", { signal: deadline, close: ["close"] });
    const next = async () => {
      const { value, done } = await messages.next();
      assert.equal(done, false, "RPC closed before response");
      return JSON.parse(value[0].toString());
    };
    const send = (fields) => socket.send(JSON.stringify({ jsonrpc: "2.0", ...fields }));
    const closed = once(socket, "close");
    closed.catch(() => {});
    return {
      closed,
      next,
      call: (id, registrationId, toolPath, input) =>
        send({ id, method: "tools.call", params: { target: { registrationId, toolPath }, input } }),
      cancel: (callId) => send({ method: "tools.call.close", params: { callId } }),
    };
  }
  async function echo(caller, registrations) {
    caller.call("echo", registrations.standard, "echo", "example");
    assert.equal((await caller.next()).result, "example");
    caller.call("echo", registrations.agent, "agent/echo", "example");
    assert.deepEqual((await caller.next()).result, { echo: "example", from: "agent" });
  }

  const first = await startCore("first");
  const second = await startCore("second");
  const addresses = ["--core", first.url, "--core", second.url];
  start(standardBinary, addresses);
  start(process.execPath, [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), ...addresses]);
  const before = await eventually(() => registry(first));
  const unaffected = await eventually(() => registry(second));
  const firstCaller = await caller(first);
  const secondCaller = await caller(second);
  await echo(firstCaller, before.registrations);
  await echo(secondCaller, unaffected.registrations);
  for (const [connection, { registrations }] of [[firstCaller, before], [secondCaller, unaffected]]) {
    connection.call("ticks", registrations.standard, "ticks", { intervalMs: 50 });
    assert.deepEqual((await connection.next()).result, { accepted: true });
    assert.equal((await connection.next()).method, "tools.call.chunk");
  }

  await stop(first);
  await firstCaller.closed;
  assert.deepEqual(await registry(second), unaffected);
  const restarted = await startCore("restarted", new URL(first.url).port);
  const after = await eventually(() => registry(restarted));
  assert.notEqual(after.coreId, before.coreId);
  for (const name of ["standard", "agent"]) {
    assert.ok(after.registrations[name]);
    assert.notEqual(after.registrations[name], before.registrations[name]);
  }
  const restartedCaller = await caller(restarted);
  restartedCaller.call("old-registration", before.registrations.standard, "echo", null);
  assert.equal((await restartedCaller.next()).error?.code, -32007);
  await echo(restartedCaller, after.registrations);
  secondCaller.cancel("ticks");
  for (;;) {
    const message = await secondCaller.next();
    assert.equal(message.params.callId, "ticks");
    if (message.method === "tools.call.result") {
      assert.equal(message.params.result.cancelled, true);
      break;
    }
    assert.equal(message.method, "tools.call.chunk");
  }
  await echo(secondCaller, unaffected.registrations);
});
