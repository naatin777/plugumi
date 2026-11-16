// 最小の呼び出し元コマンドループ。LLMなし・Queueなし。stdinから指示を受けて
// tools.catalog / tools.call / tools.call.close / plugins.add / plugins.list を
// transport上で送り、応答と届くnotificationをstdoutに表示する。

import * as readline from "node:readline";
import { currentCatalog, currentLink } from "./link.js";
import {
  METHOD_CALL,
  METHOD_CALL_CLOSE,
  METHOD_PLUGINS_ADD,
  METHOD_PLUGINS_LIST,
} from "./wire.js";

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
        list();
        return;
      case "call":
        await call(args);
        return;
      case "close":
        close(args);
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

// Tool一覧はCoreが接続時・変化時にpushするtools.catalogの最新版を見る
// （docs/contracts/00001）。PluginがCoreへ問い合わせる必要はない。
function list(): void {
  const tools = currentCatalog();
  if (tools.length === 0) {
    console.log("(no tools yet)");
    return;
  }
  for (const tool of tools) console.log(JSON.stringify(tool));
}

async function call(args: string[]): Promise<void> {
  const [linkId, toolPath, ...rest] = args;
  if (!linkId || !toolPath) {
    console.log("usage: call <linkId> <toolPath> [json]");
    return;
  }
  const link = currentLink();
  if (!link) {
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

function close(args: string[]): void {
  const [callId] = args;
  const link = currentLink();
  if (!callId || !link) {
    console.log("usage: close <callId>");
    return;
  }
  link.conn.notify(METHOD_CALL_CLOSE, { callId });
  console.log(`[close] sent for ${callId}`);
}

// Plugin EndpointをCoreへ動的登録する（transport上の plugins.add request）。
async function register(args: string[]): Promise<void> {
  const [endpoint] = args;
  const link = currentLink();
  if (!endpoint || !link) {
    console.log("usage: register <endpoint>");
    return;
  }
  const response = await link.conn.request(METHOD_PLUGINS_ADD, { endpoint });
  console.log(`[register] ${JSON.stringify(response.result ?? response.error)}`);
}

// 登録済みPlugin Endpoint一覧（transport上の plugins.list request）。
async function plugins(): Promise<void> {
  const link = currentLink();
  if (!link) {
    console.log("no link yet");
    return;
  }
  const response = await link.conn.request(METHOD_PLUGINS_LIST, {});
  const result = response.result as { plugins?: unknown[] } | undefined;
  for (const plugin of result?.plugins ?? []) console.log(JSON.stringify(plugin));
}
