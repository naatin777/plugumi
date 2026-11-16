// Plugin側のSession機構。hello応答・tools.set送信・ping・WS接続・
// tools.callの配送までをまとめる。PluginはCoreを事前に知らず、
// helloで受け取った core_url 宛てに以後の送信を行う。

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Conn } from "./rpc.js";
import { dispatchCall, toolDecls } from "./tools.js";
import { METHOD_CALL, METHOD_CALL_CLOSE } from "./wire.js";
import type { CallParams, HelloRequest, PluginInfo } from "./wire.js";

const PROTOCOL_VERSION = "0.1.0";

const PLUGIN_INFO: PluginInfo = {
  id: "agent",
  version: "0.1.0",
  name: "Plugumi Agent (minimal caller)",
};

export interface SessionState {
  sessionId: string;
  registrationId: string;
  coreUrl: string;
  conn?: Conn;
}

export const state: SessionState = {
  sessionId: "",
  registrationId: "",
  coreUrl: "",
};

export function servePlugin(listen: string): void {
  const [host, portStr] = listen.split(":");
  const port = Number(portStr);

  const app = new Hono();
  app.post("/v1/session/hello", async (c) => {
    const req = (await c.req.json()) as HelloRequest;
    if (
      req.protocolVersion &&
      req.protocolVersion.split(".")[0] !== PROTOCOL_VERSION.split(".")[0]
    ) {
      return c.json(
        { error: { code: "protocol_mismatch", message: "protocolVersion mismatch" } },
        426,
      );
    }
    state.sessionId = req.sessionId;
    state.registrationId = req.registrationId;
    state.coreUrl = req.core.url;
    console.log(
      `[agent] session established: ${state.sessionId} (reg ${state.registrationId}, core ${state.coreUrl})`,
    );
    void startSession();
    return c.json({ plugin: PLUGIN_INFO });
  });

  serve({ fetch: app.fetch, hostname: host, port });
  console.log(`[agent] listening on ${listen}`);
}

async function startSession(): Promise<void> {
  await postJSON(`${state.coreUrl}/v1/tools/set`, {
    sessionId: state.sessionId,
    tools: toolDecls(),
  }).catch((error) => console.error(`[agent] tools.set failed: ${error}`));

  setInterval(() => {
    void postJSON(`${state.coreUrl}/v1/session/ping`, {
      sessionId: state.sessionId,
    }).catch(() => {});
  }, 30_000);

  await connectWebSocket();
}

async function connectWebSocket(): Promise<void> {
  const url =
    state.coreUrl.replace("http://", "ws://") +
    `/v1/ws?sessionId=${state.sessionId}`;
  const conn = await Conn.connect(url);
  state.conn = conn;
  conn.onRequest = async (message) => {
    if (message.method === METHOD_CALL) {
      return dispatchCall(conn, message.id, message.params as CallParams);
    }
    return { error: { code: -32601, message: "method not found" } };
  };
  conn.onNotif = (message) => {
    // caller側として届く途中出力・終端はそのまま表示。
    console.log(`\n[out ${message.method}] ${JSON.stringify(message.params)}`);
  };
  conn.onClose = () => {
    console.log("\n[agent] ws closed");
  };
}

export async function postJSON(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}
