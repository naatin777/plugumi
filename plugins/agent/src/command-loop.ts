// 最小の呼び出し元コマンドループ。LLMなし・Queueなし。stdinから指示を受けて
// tools.call / tools.call.close をtransport上で送り、応答と届くnotificationを
// stdoutに表示する。Tool一覧はCoreがPOST /v1/tools/catalogでpushした最新版を見る。

import * as readline from "node:readline";
import { currentLink } from "./link.js";
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
        list();
        return;
      case "call":
        await call(args);
        return;
      case "close":
        close(args);
        return;
      case "help":
        console.log("commands: list | call <linkId> <toolPath> [json] | close <callId>");
        return;
      default:
        console.log(`unknown command: ${command} (try "help")`);
    }
  } catch (error) {
    console.log(`error: ${error}`);
  }
}

// Tool一覧はCoreがpushするcatalogの最新版を見る（docs/contracts/00001）。
// PluginがCoreへ問い合わせる必要はない。
function list(): void {
  const tools = currentLink()?.catalog ?? [];
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
  const conn = currentLink()?.conn;
  if (!conn) {
    console.log("no transport yet");
    return;
  }
  const input = rest.length > 0 ? JSON.parse(rest.join(" ")) : undefined;
  // Coreのforward timeoutは120s。応答が来ないcallでREPLが
  // 永久に詰まらないよう、それを上回るtimeoutを設ける。
  const response = await Promise.race([
    conn.request(METHOD_CALL, {
      target: { linkId, toolPath },
      input,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("call timed out")), 130_000),
    ),
  ]);
  // async受理後もnotificationはcallId相関で届き続ける（link.tsで表示）。
  // responseのJSON-RPC idがこの呼び出しのcallId（closeはこれを指定する）。
  // idは文字列なのでquoteせずそのまま出す — JSON.stringifyすると
  // `"plugin-3"`のように引用符付きで表示され、closeへ貼ると一致しない。
  console.log(
    `[res callId=${String(response.id)}] ${JSON.stringify(response.result ?? response.error)}`,
  );
}

function close(args: string[]): void {
  const [callId] = args;
  const conn = currentLink()?.conn;
  if (!callId || !conn) {
    console.log("usage: close <callId>");
    return;
  }
  conn.notify(METHOD_CALL_CLOSE, { callId });
  console.log(`[close] sent for ${callId}`);
}
