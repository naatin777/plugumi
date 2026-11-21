// 最小の呼び出し元コマンドループ。LLMなし・Queueなし。stdinから指示を受けて
// tools.call / tools.call.close をWS接続上で送り、応答と届くnotificationを
// stdoutに表示する。Coreを選び、SSEとSnapshotで同期したTool一覧を見る。

import * as readline from "node:readline";
import type { CoreClient } from "./core-client.js";
import { METHOD_CALL, METHOD_CALL_CLOSE } from "./wire.js";

export function startCommandLoop(clients: CoreClient[], input: NodeJS.ReadableStream = process.stdin): readline.Interface {
  const readlineInterface = readline.createInterface({ input });
  let current = clients[0];
  readlineInterface.setPrompt("agent> ");
  readlineInterface.prompt();
  readlineInterface.on("line", (line) => {
    const switchCore = /^core(?:\s+(\d+))?$/.exec(line.trim());
    if (switchCore) {
      const index = Number(switchCore[1]) - 1;
      if (clients[index]) current = clients[index];
      clients.forEach((client, index) => console.log(`${index + 1}: ${client.url.origin}${client === current ? " *" : ""}`));
      readlineInterface.prompt();
      return;
    }
    void handle(current, clients, line.trim()).finally(() => readlineInterface.prompt());
  });
  return readlineInterface;
}

async function handle(client: CoreClient, clients: CoreClient[], line: string): Promise<void> {
  const [command, ...args] = line.split(/\s+/);
  try {
    switch (command) {
      case "":
        return;
      case "list":
        list(client);
        return;
      case "call":
        await call(client, line);
        return;
      case "close":
        close(clients, args);
        return;
      case "help":
        console.log("commands: core [number] | list | call <registrationId> <toolPath> [json] | close <callId>");
        return;
      default:
        console.log(`unknown command: ${command} (try "help")`);
    }
  } catch (error) {
    console.log(`error: ${error}`);
  }
}

function list(client: CoreClient): void {
  const tools = client.catalog;
  if (tools.length === 0) {
    console.log("(no tools yet)");
    return;
  }
  for (const tool of tools) console.log(JSON.stringify(tool));
}

async function call(client: CoreClient, line: string): Promise<void> {
  const parts = /^call\s+(\S+)\s+(\S+)(?:\s+(.+))?$/.exec(line);
  if (!parts) {
    console.log("usage: call <registrationId> <toolPath> [json]");
    return;
  }
  const connection = client.connection;
  if (!connection) {
    console.log("not connected yet");
    return;
  }
  const [, registrationId, toolPath, rawInput] = parts;
  const input = rawInput === undefined ? undefined : JSON.parse(rawInput);
  // Coreのforward timeoutは120s。応答が来ないcallでREPLが
  // 永久に詰まらないよう、それを上回るtimeoutを設ける。
  const response = await connection.request(METHOD_CALL, {
    target: { registrationId, toolPath },
    input,
  }, 130_000);
  // closeへそのまま貼れるよう、callIdには引用符を付けない。
  console.log(
    `[res callId=${String(response.id)}] ${JSON.stringify(response.result ?? response.error)}`,
  );
}

function close(clients: CoreClient[], args: string[]): void {
  const [callId] = args;
  if (!callId) {
    console.log("usage: close <callId>");
    return;
  }
  const connection = clients.find((client) => client.connection?.ownsRequestId(callId))?.connection;
  if (!connection?.notify(METHOD_CALL_CLOSE, { callId })) {
    console.log(`[close] no open connection for ${callId}`);
    return;
  }
  console.log(`[close] sent for ${callId}`);
}
