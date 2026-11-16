// 最小の呼出元REPL。LLMなし・Queueなし — stdinから指示を受けて
// tools.list / tools.call / tools.call.close を送り、
// 応答と届くnotificationをstdoutに表示する。

import * as readline from "node:readline";
import { postJSON, state } from "./session.js";
import { METHOD_CALL, METHOD_CALL_CLOSE } from "./wire.js";

export function startRepl(): void {
  const rl = readline.createInterface({ input: process.stdin });
  rl.setPrompt("agent> ");
  rl.prompt();
  rl.on("line", (line) => {
    void handle(line.trim()).finally(() => rl.prompt());
  });
}

async function handle(line: string): Promise<void> {
  const [cmd, ...args] = line.split(/\s+/);
  try {
    switch (cmd) {
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
      case "help":
        console.log("commands: list | call <registrationId> <toolPath> [json] | close <callId>");
        return;
      default:
        console.log(`unknown command: ${cmd} (try "help")`);
    }
  } catch (e) {
    console.log(`error: ${e}`);
  }
}

async function list(): Promise<void> {
  const res = (await postJSON(`${state.coreUrl}/v1/tools/list`, {
    sessionId: state.sessionId,
  })) as { tools: unknown[] };
  for (const t of res.tools) console.log(JSON.stringify(t));
}

async function call(args: string[]): Promise<void> {
  const [regId, toolPath, ...rest] = args;
  if (!regId || !toolPath) {
    console.log("usage: call <registrationId> <toolPath> [json]");
    return;
  }
  if (!state.conn) {
    console.log("no session yet");
    return;
  }
  const input = rest.length > 0 ? JSON.parse(rest.join(" ")) : undefined;
  const res = await state.conn.request(METHOD_CALL, {
    target: { registrationId: regId, toolPath },
    input,
  });
  // async受理後もnotificationはcallId相関で届き続ける（session.tsで表示）。
  console.log(`[res] ${JSON.stringify(res.result ?? res.error)}`);
}

async function close(args: string[]): Promise<void> {
  const [callId] = args;
  if (!callId || !state.conn) {
    console.log("usage: close <callId>");
    return;
  }
  state.conn.notify(METHOD_CALL_CLOSE, { callId });
  console.log(`[close] sent for ${callId}`);
}
