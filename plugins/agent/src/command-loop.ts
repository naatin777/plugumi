// 最小の呼び出し元コマンドループ。LLMなし・Queueなし。stdinから指示を受けて
// operations.invoke / executions.cancel を送り、応答と届くeventを
// stdoutに表示する。Coreを選び、catalog追跡したoperation一覧を見る。

import * as readline from "node:readline";
import type { CoreClient } from "./core-client.js";

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
    void handle(current, line.trim()).finally(() => readlineInterface.prompt());
  });
  return readlineInterface;
}

async function handle(client: CoreClient, line: string): Promise<void> {
  const [command, ...args] = line.split(/\s+/);
  try {
    switch (command) {
      case "":
        return;
      case "list":
        list(client);
        return;
      case "invoke":
        await invoke(client, line);
        return;
      case "cancel":
        await cancel(client, args);
        return;
      case "help":
        console.log("commands: core [number] | list | invoke <operation> [json] | cancel <executionId>");
        return;
      default:
        console.log(`unknown command: ${command} (try "help")`);
    }
  } catch (error) {
    console.log(`error: ${error}`);
  }
}

function list(client: CoreClient): void {
  const operations = client.catalog;
  if (operations.length === 0) {
    console.log("(no operations yet)");
    return;
  }
  for (const operation of operations) console.log(JSON.stringify(operation));
}

async function invoke(client: CoreClient, line: string): Promise<void> {
  const parts = /^invoke\s+(\S+)(?:\s+(.+))?$/.exec(line);
  if (!parts) {
    console.log("usage: invoke <operation> [json]");
    return;
  }
  const [, operation, rawInput] = parts;
  const input = rawInput === undefined ? undefined : JSON.parse(rawInput);
  const execution = await client.invoke(operation, input, (event) => {
    console.log(`[event ${event.type} seq=${event.seq}] ${JSON.stringify(event.payload)}`);
  });
  console.log(`[execution ${execution.id}] ${execution.status} ${JSON.stringify(execution.result ?? execution.error ?? "")}`);
}

async function cancel(client: CoreClient, args: string[]): Promise<void> {
  const [executionId] = args;
  if (!executionId) {
    console.log("usage: cancel <executionId>");
    return;
  }
  const execution = await client.cancel(executionId);
  console.log(`[cancel ${execution.id}] accepted, status: ${execution.status}`);
}
