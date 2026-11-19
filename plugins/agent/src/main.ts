#!/usr/bin/env node
import { parseArgs } from "node:util";
import { startCommandLoop } from "./command-loop.js";
import { servePlugin } from "./link.js";

// ローカルPluginの既定ホストとポートは docs/contracts/00001 に従う。
const DEFAULT_HOSTNAME = "127.0.0.1";
const usage = `Usage: plugumi-agent [--port <port> | --listen <url> | <url> | --help]

From the source checkout, use 'pnpm start' instead of 'plugumi-agent'.

  --port <port>   Listen on ${DEFAULT_HOSTNAME} (default: 0 lets the OS choose)
  --listen <url>  Listen on http://<host>:<port>
  -h, --help      Show this help`;

function parseListenArgument(): { endpoint: string; hostname: string; port: number } | undefined {
  try {
    const { values, positionals } = parseArgs({
      options: {
        port: { type: "string" },
        listen: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });
    if (values.help) {
      console.log(usage);
      return;
    }
    const options = [values.port, values.listen, ...positionals].filter((value) => value !== undefined);
    if (options.length > 1) {
      throw new Error("Specify only one of --port, --listen, or a positional URL.");
    }
    const endpoint = values.listen ?? positionals[0];
    if (endpoint !== undefined) {
      return { endpoint, ...parseListenURL(endpoint) };
    }

    const portOption = values.port ?? "0";
    const port = Number(portOption);
    if (!/^\d+$/.test(portOption) || port > 65535) {
      throw new Error(`--port must be an integer from 0 to 65535 (got ${portOption})`);
    }
    return { endpoint: `http://${DEFAULT_HOSTNAME}:${port}`, hostname: DEFAULT_HOSTNAME, port };
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage);
    process.exitCode = 2;
    return;
  }
}

function parseListenURL(endpoint: string): { hostname: string; port: number } {
  // URL.portは明示した80も空にするため、ポートの指定は元の文字列で確認する。
  const port = /^http:\/\/[^/?#@\\\s]+:(\d+)\/?$/.exec(endpoint)?.[1];
  const url = URL.parse(endpoint);
  if (port === undefined || url === null) {
    throw new Error(`endpoint must be http://<host>:<port> (got ${endpoint})`);
  }
  return { hostname: url.hostname.replace(/^\[|\]$/g, ""), port: Number(port) };
}

const listen = parseListenArgument();
if (listen !== undefined) {
  try {
    const boundEndpoint = await servePlugin(listen.hostname, listen.port);
    console.log(`[agent] listening on ${boundEndpoint}`);
    startCommandLoop();
  } catch (error) {
    console.error(`[agent] could not listen on ${listen.endpoint}: ${error}`);
    process.exitCode = 1;
  }
}
