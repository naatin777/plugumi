import { startCommandLoop } from "./command-loop.js";
import { servePlugin } from "./link.js";

// 起動引数はPlugin Endpoint（`ws://<host>:<port>`）。
// Coreがdialするendpointと同じ文字列に揃える（docs/contracts/00001）。
// wssはTLS未実装のため受理しない。
function parseListen(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (url.protocol === "ws:" && url.pathname === "/") return url.host;
  } catch {
    // fallthrough: 不正なendpointは起動引数ミスとしてusageを出す
  }
  console.error(`endpoint must be ws://<host>:<port> (got ${endpoint})`);
  process.exit(2);
}

const endpoint = process.argv[2] ?? "ws://127.0.0.1:9002";
const listen = parseListen(endpoint);
servePlugin(listen);
startCommandLoop();
