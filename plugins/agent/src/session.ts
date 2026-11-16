// Plugin側のSession機構。hello応答・tools.set送信・ping・WS接続・
// tools.callの配送までをまとめる。PluginはCoreを事前に知らず、
// helloで受け取った core_url 宛てに以後の送信を行う。
//
// SessionはsessionIdごとに独立して管理する — 複数のCoreが
// 同じPluginへhelloしてよい（docs/decisionsの複数Core方針）。

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
  pingTimer?: NodeJS.Timeout;
}

// Core別のSessionを束ねる。sessionId →
const sessions = new Map<string, SessionState>();
// コマンドループの既定対象（直近にhelloされたSession）。
let primarySessionId = "";

export function currentSession(): SessionState | undefined {
  return sessions.get(primarySessionId);
}

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

    // 同じCoreからの再helloは、そのCoreの旧Sessionを畳んでから受け入れる
    // （別CoreのSessionは生かす — 複数Core接続を許すため）。
    for (const [id, session] of sessions) {
      if (session.coreUrl === req.core.url) {
        teardownSession(session);
        sessions.delete(id);
      }
    }

    const session: SessionState = {
      sessionId: req.sessionId,
      registrationId: req.registrationId,
      coreUrl: req.core.url,
    };
    sessions.set(session.sessionId, session);
    primarySessionId = session.sessionId;
    console.log(
      `[agent] session established: ${session.sessionId} (reg ${session.registrationId}, core ${session.coreUrl})`,
    );
    void startSession(session);
    return c.json({ plugin: PLUGIN_INFO });
  });

  serve({ fetch: app.fetch, hostname: host, port });
  console.log(`[agent] listening on ${listen}`);
}

/// Sessionを畳む: pingを止め、channelを切る（実行中callのcloseはCore側が処理）。
function teardownSession(session: SessionState): void {
  if (session.pingTimer) clearInterval(session.pingTimer);
  session.conn = undefined;
}

/// Session確立後のライフサイクル: tools.set → pingループ → WS channel。
/// 途中でSessionが畳まれても（Core側の失効・再起動hello）、
/// ping/接続loopはsessions mapを見て終わる。
async function startSession(session: SessionState): Promise<void> {
  // tools.setは短く再試行する — 直列失敗でもsessionを無toolにしない。
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (!sessions.has(session.sessionId)) return;
    try {
      await postJSON(`${session.coreUrl}/v1/tools/set`, {
        sessionId: session.sessionId,
        tools: toolDecls(),
      });
      break;
    } catch (error) {
      console.error(`[agent] tools.set failed (attempt ${attempt}): ${error}`);
      await sleep(1000);
    }
  }

  session.pingTimer = setInterval(() => {
    void postJSON(`${session.coreUrl}/v1/session/ping`, {
      sessionId: session.sessionId,
    }).catch(() => {});
  }, 30_000);

  await connectWebSocketLoop(session);
}

/// WS channelを張り続ける。切断されてもSessionが生きている限り再試行する
/// （channel切断とSession失効は別 — contracts/00002）。
async function connectWebSocketLoop(session: SessionState): Promise<void> {
  while (sessions.has(session.sessionId)) {
    try {
      const conn = await connectOnce(session);
      session.conn = conn;
      await new Promise<void>((resolve) => {
        conn.onClose = () => {
          console.log("\n[agent] ws closed");
          resolve();
        };
      });
      session.conn = undefined;
    } catch {
      console.log(`[agent] ws connect failed (retrying)`);
    }
    if (sessions.has(session.sessionId)) await sleep(3000);
  }
}

async function connectOnce(session: SessionState): Promise<Conn> {
  const url =
    session.coreUrl.replace("http://", "ws://") +
    `/v1/ws?sessionId=${session.sessionId}`;
  const conn = await Conn.connect(url);
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
  return conn;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
