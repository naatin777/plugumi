// Plugin側のLink機構。PluginはCoreを知らず、接続を開始しない。
// 共通規格はREST受付（hello・ping・tools・catalog）、
// tools.callの流路だけ `GET /v1/transport?linkId=` のWS upgradeを受ける。
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
} from "./wire.js";
import type {
  CallParams,
  CatalogRequest,
  HelloRequest,
  Incoming,
  ListedTool,
  PingRequest,
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
  // tools.call用のtransport。upgradeされるまでは未接続。
  conn?: Conn;
  // Coreがpushしてきた全Tool一覧（list・toolPath解決用）。
  catalog: ListedTool[];
}

// Core別のLinkを束ねる。linkId →
const links = new Map<string, LinkState>();
// コマンドループの既定対象（直近にhelloされたLink）。
let primaryLinkId = "";

export function currentLink(): LinkState | undefined {
  return links.get(primaryLinkId);
}

const apiError = (c: { json: (b: unknown, s: number) => Response }, status: number, code: string, message: string) =>
  c.json({ error: { code, message } }, status);

export function servePlugin(listen: string): void {
  const [host, portStr] = listen.split(":");
  const port = Number(portStr);

  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // POST /v1/link/hello: 同じcore.idの旧Linkを差し替え、Linkを登録して
  // plugin情報を返す。transportは別途 /v1/transport で結ばれる。
  app.post("/v1/link/hello", async (c) => {
    let req: HelloRequest;
    try {
      req = await c.req.json<HelloRequest>();
    } catch {
      return apiError(c, 400, "invalid_params", "invalid params");
    }
    if (!req?.linkId || !req.core?.id) {
      return apiError(c, 400, "invalid_params", "invalid params");
    }

    // 同じCoreからの再helloは、そのCoreの旧Linkを破棄してから受け入れる
    // （別CoreのLinkは生かす。複数Core接続を許すため）。
    for (const [id, existing] of links) {
      if (existing.coreId === req.core.id) links.delete(id);
    }

    const link: LinkState = { linkId: req.linkId, coreId: req.core.id, catalog: [] };
    links.set(link.linkId, link);
    primaryLinkId = link.linkId;
    console.log(`[agent] link established: ${link.linkId} (core ${link.coreId})`);
    return c.json({ plugin: PLUGIN_INFO });
  });

  // POST /v1/link/ping: Core→Pluginの生存確認probe。
  app.post("/v1/link/ping", async (c) => {
    let req: PingRequest;
    try {
      req = await c.req.json<PingRequest>();
    } catch {
      return apiError(c, 400, "invalid_params", "invalid params");
    }
    // 必須field欠落はinvalid_params、未知linkIdはunknown_link
    // （contracts/00001のエラー表。Rust版はserde必須fieldで同じ区別をする）。
    if (typeof req?.linkId !== "string" || req.linkId === "") {
      return apiError(c, 400, "invalid_params", "invalid params");
    }
    if (!links.has(req.linkId)) {
      return apiError(c, 404, "unknown_link", "no such linkId");
    }
    return c.json({});
  });

  // GET /v1/tools: このPluginのTool宣言を返す（Coreがpullする）。
  app.get("/v1/tools", (c) => c.json({ tools: toolDecls() }));

  // POST /v1/tools/catalog: Coreからの全Tool一覧pushを受け取る。
  app.post("/v1/tools/catalog", async (c) => {
    let req: CatalogRequest;
    try {
      req = await c.req.json<CatalogRequest>();
    } catch {
      return apiError(c, 400, "invalid_params", "invalid params");
    }
    if (typeof req?.linkId !== "string" || req.linkId === "" || !Array.isArray(req.tools)) {
      return apiError(c, 400, "invalid_params", "invalid params");
    }
    const link = links.get(req.linkId);
    if (!link) {
      return apiError(c, 404, "unknown_link", "no such linkId");
    }
    link.catalog = req.tools;
    return c.json({});
  });

  // GET /v1/transport?linkId=: tools.call用WSのupgrade受付。
  // 現存するLinkにだけtransportを結ぶ。不明なlinkIdはupgrade前に404。
  app.get(
    "/v1/transport",
    async (c, next) => {
      const linkId = c.req.query("linkId") ?? "";
      // query欠落はinvalid_params、未知linkIdはunknown_link
      // （Rust版のtransport_upgradeと同じ区別）。
      if (linkId === "") {
        return apiError(c, 400, "invalid_params", "linkId required");
      }
      if (!links.has(linkId)) {
        return apiError(c, 404, "unknown_link", "no such linkId");
      }
      return next();
    },
    upgradeWebSocket((c) => {
      const linkId = c.req.query("linkId") ?? "";
      const link = links.get(linkId);
      return {
        onOpen(_event, ws) {
          const raw = ws.raw;
          if (!raw || !link) return;
          handleConn(link, {
            send: (data) => raw.send(data),
            close: () => raw.close(),
            onMessage: (listener) =>
              raw.on("message", (data, isBinary) => {
                if (!isBinary) listener(String(data));
              }),
            onClose: (listener) => raw.on("close", () => listener()),
          });
        },
      };
    }),
  );

  // versionはURL prefixで表す（contracts/00001）。
  // 知っているversion以外の/vN/はprotocol_mismatchで拒否する。
  app.notFound((c) => {
    const version = c.req.path.split("/")[1] ?? "";
    // /vN/（Nは数字）だけがversion付きpath。/vX/等は未知pathで404
    // （contracts/00001）。
    const isVersionPath = /^v\d+$/.test(version);
    if (isVersionPath && version !== "v1") {
      return apiError(c, 426, "protocol_mismatch", "unsupported protocol version");
    }
    return apiError(c, 404, "unknown_endpoint", "unknown endpoint");
  });

  const server = serve({ fetch: app.fetch, hostname: host, port });
  injectWebSocket(server);
  console.log(`[agent] listening on ${listen}`);
}

// 1本のtransport（WS）のライフサイクル。upgrade→tools.call配送→切断でLink失効。
// 共通規格はRESTで行うため、ここに届くのはtools.call系のみ。
function handleConn(link: LinkState, socket: Socket): void {
  const conn = Conn.attach(socket);
  link.conn = conn;

  conn.onRequest = async (message) => {
    if (message.method === METHOD_CALL) {
      return dispatchCall(conn, message.id, message.params as CallParams);
    }
    return { error: { code: -32601, message: "method not found" } };
  };

  conn.onNotif = (message: Incoming) => {
    switch (message.method) {
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
    if (links.get(link.linkId) === link) links.delete(link.linkId);
    if (link.conn === conn) link.conn = undefined;
    console.log(`\n[agent] transport closed: ${link.linkId}`);
  };
}
