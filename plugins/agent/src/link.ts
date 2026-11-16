// Plugin側のLink機構。PluginはCoreを知らず、接続を開始しない。
// Coreが `GET /v1/transport` でupgradeしてきたWS上で、
// link.hello応答・tools.set送信・ping・tools.callの配送を行う。
//
// LinkはlinkIdごとに独立して管理する。複数のCoreが
// 同じPluginへ接続してよい（docs/decisionsの複数Core方針）。

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { Conn } from "./rpc.js";
import type { Socket } from "./rpc.js";
import { dispatchCall, toolDecls } from "./tools.js";
import {
  METHOD_CALL,
  METHOD_CALL_CLOSE,
  METHOD_CALL_OUTPUT,
  METHOD_CALL_RESULT,
  METHOD_LINK_HELLO,
  METHOD_LINK_PING,
  METHOD_TOOLS_CATALOG,
  METHOD_TOOLS_SET,
} from "./wire.js";
import type {
  CallParams,
  HelloRequest,
  Incoming,
  ListedTool,
  PluginInfo,
} from "./wire.js";

const PLUGIN_INFO: PluginInfo = {
  id: "agent",
  version: "0.1.0",
  name: "Plugumi Agent (minimal caller)",
};

export interface LinkState {
  linkId: string;
  // 再helloの差替え判定に使う不透明な識別子（宛先ではない）。
  coreId: string;
  conn: Conn;
  pingTimer?: NodeJS.Timeout;
}

// Core別のLinkを束ねる。linkId →
const links = new Map<string, LinkState>();
// コマンドループの既定対象（直近にhelloされたLink）。
let primaryLinkId = "";

// tools.catalogの最新版。コマンドループの list ・将来のtoolPath解決に使う。
let catalog: ListedTool[] = [];

export function currentLink(): LinkState | undefined {
  return links.get(primaryLinkId);
}

export function currentCatalog(): ListedTool[] {
  return catalog;
}

export function servePlugin(listen: string): void {
  const [host, portStr] = listen.split(":");
  const port = Number(portStr);

  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get(
    "/v1/transport",
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        const raw = ws.raw;
        if (!raw) return;
        handleConn({
          send: (data) => raw.send(data),
          close: () => raw.close(),
          onMessage: (listener) =>
            raw.on("message", (data, isBinary) => {
              if (!isBinary) listener(String(data));
            }),
          onClose: (listener) => raw.on("close", () => listener()),
        });
      },
    })),
  );

  // versionはURL prefixで表す（contracts/00001）。
  // 知っているversion以外の/vN/はprotocol_mismatchで拒否する。
  app.notFound((c) => {
    const version = c.req.path.split("/")[1] ?? "";
    if (version.startsWith("v") && version !== "v1") {
      return c.json(
        { error: { code: "protocol_mismatch", message: "unsupported protocol version" } },
        426,
      );
    }
    return c.json(
      { error: { code: "unknown_endpoint", message: "unknown endpoint" } },
      404,
    );
  });

  const server = serve({ fetch: app.fetch, hostname: host, port });
  injectWebSocket(server);
  console.log(`[agent] listening on ${listen}`);
}

// 1本のWS接続のライフサイクル。upgrade→hello→tools.set→ping→切断でLink失効。
function handleConn(socket: Socket): void {
  const conn = Conn.attach(socket);
  // このconnのLink。hello成立まではundefined。
  let link: LinkState | undefined;

  conn.onRequest = async (message) => {
    switch (message.method) {
      case METHOD_LINK_HELLO:
        return handleHello(conn, message.params as HelloRequest, (established) => {
          link = established;
        });
      case METHOD_CALL:
        if (!link) {
          return { error: { code: -32000, message: "link not established" } };
        }
        return dispatchCall(conn, message.id, message.params as CallParams);
      default:
        return { error: { code: -32601, message: "method not found" } };
    }
  };

  conn.onNotif = (message: Incoming) => {
    switch (message.method) {
      case METHOD_TOOLS_CATALOG: {
        const params = message.params as { tools?: ListedTool[] };
        catalog = params.tools ?? [];
        return;
      }
      // callerとして届く途中出力・終端・closeはそのまま表示。
      case METHOD_CALL_OUTPUT:
      case METHOD_CALL_RESULT:
      case METHOD_CALL_CLOSE:
        console.log(`\n[out ${message.method}] ${JSON.stringify(message.params)}`);
        return;
    }
  };

  conn.onClose = () => {
    // transport切断 = Link失効（contracts/00002）。
    if (link) {
      teardownLink(link);
      if (links.get(link.linkId) === link) links.delete(link.linkId);
      console.log(`\n[agent] transport closed: ${link.linkId}`);
    } else {
      console.log("\n[agent] transport closed (before hello)");
    }
  };
}

// link.hello requestを捌く: 同じcore.idの旧Linkを差し替えてLinkを登録し、
// plugin情報を応答したあと tools.set・ping loopを起動する。
function handleHello(
  conn: Conn,
  req: HelloRequest,
  setLink: (link: LinkState) => void,
): { result?: unknown; error?: { code: number; message: string } } {
  if (!req?.linkId || !req.core?.id) {
    return { error: { code: -32602, message: "invalid params" } };
  }

  // 同じCoreからの再helloは、そのCoreの旧Linkを破棄してから受け入れる
  // （別CoreのLinkは生かす。複数Core接続を許すため）。
  for (const [id, existing] of links) {
    if (existing.coreId === req.core.id) {
      teardownLink(existing);
      links.delete(id);
    }
  }

  const link: LinkState = {
    linkId: req.linkId,
    coreId: req.core.id,
    conn,
  };
  links.set(link.linkId, link);
  primaryLinkId = link.linkId;
  setLink(link);
  console.log(`[agent] link established: ${link.linkId} (core ${link.coreId})`);

  void startLink(link);
  return { result: { plugin: PLUGIN_INFO } };
}

// Linkを破棄する: pingを止める（実行中callのcloseはCore側が処理）。
function teardownLink(link: LinkState): void {
  if (link.pingTimer) clearInterval(link.pingTimer);
}

// Link確立後のライフサイクル: tools.set送信 → pingループ。
// transportが生きている間だけ続く（Linkの寿命 = transportの寿命）。
async function startLink(link: LinkState): Promise<void> {
  try {
    const response = await link.conn.request(METHOD_TOOLS_SET, {
      tools: toolDecls(),
    });
    if (response.error) {
      console.error(`[agent] tools.set rejected: ${JSON.stringify(response.error)}`);
    }
  } catch (error) {
    console.error(`[agent] tools.set failed: ${error}`);
  }

  if (!links.has(link.linkId)) return;
  // link.pingはtransport上のnotification。Coreが止まった半開きを検出する。
  link.pingTimer = setInterval(() => {
    if (!links.has(link.linkId)) return;
    link.conn.notify(METHOD_LINK_PING, {});
  }, 30_000);
}
