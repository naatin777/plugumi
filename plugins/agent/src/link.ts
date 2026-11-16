// Plugin側のLink機構。hello応答・tools.set送信・ping・transport接続・
// tools.callの配送までをまとめる。PluginはCoreを事前に知らず、
// helloで受け取った core_url 宛てに以後の送信を行う。
//
// LinkはlinkIdごとに独立して管理する — 複数のCoreが
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

export interface LinkState {
  linkId: string;
  coreUrl: string;
  conn?: Conn;
  pingTimer?: NodeJS.Timeout;
}

// Core別のLinkを束ねる。linkId →
const links = new Map<string, LinkState>();
// コマンドループの既定対象（直近にhelloされたLink）。
let primaryLinkId = "";

export function currentLink(): LinkState | undefined {
  return links.get(primaryLinkId);
}

export function servePlugin(listen: string): void {
  const [host, portStr] = listen.split(":");
  const port = Number(portStr);

  const app = new Hono();
  app.post("/v1/link/hello", async (c) => {
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

    // 同じCoreからの再helloは、そのCoreの旧Linkを畳んでから受け入れる
    // （別CoreのLinkは生かす — 複数Core接続を許すため）。
    for (const [id, link] of links) {
      if (link.coreUrl === req.core.url) {
        teardownLink(link);
        links.delete(id);
      }
    }

    const link: LinkState = {
      linkId: req.linkId,
      coreUrl: req.core.url,
    };
    links.set(link.linkId, link);
    primaryLinkId = link.linkId;
    console.log(
      `[agent] link established: ${link.linkId} (core ${link.coreUrl})`,
    );
    void startLink(link);
    return c.json({ plugin: PLUGIN_INFO });
  });

  serve({ fetch: app.fetch, hostname: host, port });
  console.log(`[agent] listening on ${listen}`);
}

/// Linkを畳む: pingを止め、transportを切る（実行中callのcloseはCore側が処理）。
function teardownLink(link: LinkState): void {
  if (link.pingTimer) clearInterval(link.pingTimer);
  link.conn = undefined;
}

/// Link確立後のライフサイクル: tools.set → pingループ → transport。
/// 途中でLinkが畳まれても（Core側の失効・再起動hello）、
/// ping/接続loopはlinks mapを見て終わる。
async function startLink(link: LinkState): Promise<void> {
  // tools.setは短く再試行する — 直列失敗でもLinkを無toolにしない。
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (!links.has(link.linkId)) return;
    try {
      await postJSON(`${link.coreUrl}/v1/tools/set`, {
        linkId: link.linkId,
        tools: toolDecls(),
      });
      break;
    } catch (error) {
      console.error(`[agent] tools.set failed (attempt ${attempt}): ${error}`);
      await sleep(1000);
    }
  }

  link.pingTimer = setInterval(() => {
    void postJSON(`${link.coreUrl}/v1/link/ping`, {
      linkId: link.linkId,
    }).catch(() => {});
  }, 30_000);

  await connectTransportLoop(link);
}

/// transportを張り続ける。切断されてもLinkが生きている限り再試行する
/// （transport切断とLink失効は別 — contracts/00002）。
async function connectTransportLoop(link: LinkState): Promise<void> {
  while (links.has(link.linkId)) {
    try {
      const conn = await connectOnce(link);
      link.conn = conn;
      await new Promise<void>((resolve) => {
        conn.onClose = () => {
          console.log("\n[agent] transport closed");
          resolve();
        };
      });
      link.conn = undefined;
    } catch {
      console.log(`[agent] transport connect failed (retrying)`);
    }
    if (links.has(link.linkId)) await sleep(3000);
  }
}

async function connectOnce(link: LinkState): Promise<Conn> {
  const url =
    link.coreUrl.replace("http://", "ws://") +
    `/v1/transport?linkId=${link.linkId}`;
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
