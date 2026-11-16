// 最小の呼び出し元コマンドループ。LLMなし・Queueなし。stdinから指示を受けて
// tools.list / tools.call / tools.call.close を送り、
// 応答と届くnotificationをstdoutに表示する。

import * as readline from "node:readline";
import { currentLink, postJSON } from "./link.js";
import { METHOD_CALL, METHOD_CALL_CLOSE } from "./wire.js";

export function startCommandLoop(): void {
  const rl = readline.createInterface({ input: process.stdin });
  rl.setPrompt("agent> ");
  rl.prompt();
  rl.on("line", (line) => {
    void handle(line.trim()).finally(() => rl.prompt());
  });
}

async function handle(line: string): Promise<void> {
  const [command, ...args] = line.split(/\s+/);
  try {
    switch (command) {
      case "":
        return;
      case "list":
        await list();
        return;
      case "call":
        await call(args);
        return;
      case "close":
        await close(args);
        return;
      case "register":
        await register(args);
        return;
      case "plugins":
        await plugins();
        return;
      case "help":
        console.log("commands: list | call <linkId> <toolPath> [json] | close <callId> | register <endpoint> | plugins");
        return;
      default:
        console.log(`unknown command: ${command} (try "help")`);
    }
  } catch (error) {
    console.log(`error: ${error}`);
  }
}

async function list(): Promise<void> {
  const link = currentLink();
  if (!link) {
    console.log("no link yet");
    return;
  }
  const response = (await postJSON(`${link.coreUrl}/v1/tools/list`, {
    linkId: link.linkId,
  })) as { tools: unknown[] };
  for (const tool of response.tools) console.log(JSON.stringify(tool));
}

async function call(args: string[]): Promise<void> {
  const [linkId, toolPath, ...rest] = args;
  if (!linkId || !toolPath) {
    console.log("usage: call <linkId> <toolPath> [json]");
    return;
  }
  const link = currentLink();
  if (!link?.conn) {
    console.log("no link yet");
    return;
  }
  const input = rest.length > 0 ? JSON.parse(rest.join(" ")) : undefined;
  const response = await link.conn.request(METHOD_CALL, {
    target: { linkId, toolPath },
    input,
  });
  // async受理後もnotificationはcallId相関で届き続ける（link.tsで表示）。
  // responseのJSON-RPC idがこの呼び出しのcallId（closeはこれを指定する）。
  console.log(
    `[res callId=${JSON.stringify(response.id)}] ${JSON.stringify(response.result ?? response.error)}`,
  );
}

async function close(args: string[]): Promise<void> {
  const [callId] = args;
  const link = currentLink();
  if (!callId || !link?.conn) {
    console.log("usage: close <callId>");
    return;
  }
  link.conn.notify(METHOD_CALL_CLOSE, { callId });
  console.log(`[close] sent for ${callId}`);
}

// Plugin EndpointをCoreへ動的登録する（POST /v1/plugins）。
async function register(args: string[]): Promise<void> {
  const [endpoint] = args;
  const link = currentLink();
  if (!endpoint || !link) {
    console.log("usage: register <endpoint>");
    return;
  }
  const response = await postJSON(`${link.coreUrl}/v1/plugins`, { endpoint });
  console.log(`[register] ${JSON.stringify(response)}`);
}

// 登録済みPlugin Endpoint一覧（POST /v1/plugins/list）。
async function plugins(): Promise<void> {
  const link = currentLink();
  if (!link) {
    console.log("no link yet");
    return;
  }
  const response = (await postJSON(`${link.coreUrl}/v1/plugins/list`, {})) as {
    plugins: unknown[];
  };
  for (const plugin of response.plugins) console.log(JSON.stringify(plugin));
}
