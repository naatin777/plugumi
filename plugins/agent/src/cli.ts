#!/usr/bin/env node
import { parseArgs } from "node:util";
import { startCommandLoop } from "./command-loop.js";
import { CoreClient, coreURL } from "./core-client.js";
import { logPath } from "./log.js";
import { newInstanceId, registerPlugin } from "./registration.js";

const usage = "Usage: plugumi-agent [--core <url>]... [<url>...]";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { core: { type: "string", multiple: true }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const configured = [...(values.core ?? []), ...positionals];
  if (configured.length === 0 && process.env.PLUGUMI_CORE_URL) configured.push(process.env.PLUGUMI_CORE_URL);
  if (configured.length === 0) throw new Error("Specify at least one Core URL");
  const origins = new Set(configured.map((entry) => coreURL(entry).origin));
  const id = newInstanceId();
  const clients = [...origins].map((origin) => new CoreClient(coreURL(origin), id, process.env.PLUGUMI_TOKEN));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const unregister = registerPlugin({ name: "agent", id, version: "0.1.0", pid: process.pid, log: logPath() });
  const commandLoop = startCommandLoop(clients);
  try {
    const outcomes = await Promise.all(clients.map((client) => client.run(controller.signal)));
    if (!controller.signal.aborted && outcomes.every((outcome) => outcome === "rejected")) {
      process.exitCode = 1;
    }
  } finally {
    commandLoop.close();
    unregister?.();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

try {
  await main();
} catch (error) {
  console.error(`${error}\n${usage}`);
  process.exitCode = 2;
}
