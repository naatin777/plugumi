// Coreへの登録・Tool宣言・RPC接続のsession（contracts/00004）。
// 1インスタンスが1つのCoreと対応し、切断しても再登録を繰り返す。
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { Connection } from "./rpc.js";
import { dispatchToolCall } from "./tools.js";
import type { Tool } from "./tools.js";
import {
  registrationLeaseSchema,
  registrySnapshotSchema,
} from "./wire.js";
import type { Incoming, ListedTool, RpcError } from "./wire.js";

const API = "/v1";

class CoreHTTPError extends Error {
  constructor(readonly status: number, method: string, path: string) {
    super(`${method} ${path}: HTTP ${status}`);
  }
}

export function coreURL(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Core URL must be an HTTP(S) origin");
  }
  return url;
}

export interface PluginClientOptions {
  url: URL;
  pluginId: string;
  pluginInstanceId: string;
  // PLUGUMI_TOKENに対応するBearer資格情報（Coreに設定されている場合必須）。
  token?: string;
  // 提供するTool。tools.callのdispatchはこれから自動で作る。
  tools: readonly Tool[];
  // tools.call以外も自前で捌きたいときに上書きする。
  onRequest?: (message: Incoming) => Promise<{ result?: unknown; error?: RpcError }>;
  onNotification?: (message: Incoming) => void;
  // RegistryのSSE購読＋Snapshotでthis.catalogを最新に保つ。
  // Tool呼び出し側になるPluginだけ有効にすればよい。
  catalog?: boolean;
  log?: (message: string) => void;
}

export class PluginClient {
  connection?: Connection;
  catalog: ListedTool[] = [];
  private registrationId?: string;
  private readonly headers: Record<string, string>;
  private readonly onRequest: (message: Incoming) => Promise<{ result?: unknown; error?: RpcError }>;
  private readonly log: (message: string) => void;

  constructor(readonly options: PluginClientOptions) {
    this.headers = options.token ? { Authorization: `Bearer ${options.token}` } : {};
    this.onRequest = options.onRequest ?? dispatchToolCall(options.tools);
    this.log = options.log ?? (() => {});
  }

  get url(): URL {
    return this.options.url;
  }

  async request(method: string, path: string, signal: AbortSignal, body?: object): Promise<Response> {
    const response = await fetch(new URL(API + path, this.url), {
      method, signal, redirect: "error",
      headers: body === undefined ? this.headers : { ...this.headers, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreHTTPError(response.status, method, path);
    }
    return response;
  }

  async run(signal: AbortSignal): Promise<"stopped" | "rejected"> {
    let backoff = 250;
    try {
      while (!signal.aborted) {
        try {
          await this.runSession(signal);
          backoff = 250;
        } catch (error) {
          if (signal.aborted) break;
          this.log(`${this.url.origin}: ${error}`);
          if (error instanceof CoreHTTPError && [401, 403, 426].includes(error.status)) return "rejected";
        }
        if (!signal.aborted) {
          await delay(backoff + Math.random() * backoff / 4, undefined, { signal }).catch(() => {});
          backoff = Math.min(backoff * 2, 5_000);
        }
      }
    } finally {
      if (signal.aborted && this.registrationId) {
        await this.request("DELETE", `/registrations/${encodeURIComponent(this.registrationId)}`,
          AbortSignal.timeout(1500)).catch(() => {});
      }
    }
    return "stopped";
  }

  private async runSession(stop: AbortSignal): Promise<void> {
    const session = new AbortController();
    const signal = AbortSignal.any([stop, session.signal]);
    const requestSignal = () => AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    const registration = await this.request("POST", "/registrations", requestSignal(), {
      pluginId: this.options.pluginId, pluginInstanceId: this.options.pluginInstanceId,
    });
    const lease = registrationLeaseSchema.parse(await registration.json());
    this.registrationId = lease.registrationId;
    const path = `/registrations/${encodeURIComponent(lease.registrationId)}`;
    await this.request("PUT", `${path}/tools`, requestSignal(), {
      tools: this.options.tools.map((tool) => tool.declaration),
    });

    const { connection, closed } = await this.connect(lease.registrationId, signal);
    this.connection = connection;
    this.log(`connected to ${this.url.origin} (${lease.registrationId})`);
    const subscription = this.options.catalog ? this.watchRegistry(signal) : undefined;
    const renew = (async () => {
      while (!signal.aborted) {
        await delay(lease.leaseSeconds * 500, undefined, { signal });
        await (await this.request("POST", `${path}/renew`, requestSignal())).json();
      }
    })();
    try {
      await Promise.race([closed, renew]);
    } finally {
      session.abort();
      this.connection = undefined;
      this.catalog = [];
      await Promise.allSettled(subscription === undefined
        ? [closed, renew]
        : [closed, renew, subscription]);
    }
  }

  private connect(registrationId: string, signal: AbortSignal): Promise<{ connection: Connection; closed: Promise<void> }> {
    const url = new URL(`${API}/rpc`, this.url);
    url.protocol = this.url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("registrationId", registrationId);
    return new Promise((resolve, reject) => {
      const raw = new WebSocket(url, {
        headers: this.headers, followRedirects: false,
        handshakeTimeout: 5000, maxPayload: 1 << 20,
      });
      const abort = () => raw.terminate();
      raw.on("error", reject);
      raw.once("unexpected-response", (_request, response) => {
        reject(new CoreHTTPError(response.statusCode ?? 0, "GET", url.pathname));
        response.destroy();
        raw.terminate();
      });
      raw.once("close", () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("RPC closed before upgrade"));
      });
      raw.once("open", () => {
        const connection = Connection.attach({
          send: (data) => {
            if (raw.readyState !== WebSocket.OPEN) throw new Error("RPC connection closed");
            raw.send(data);
          },
          close: () => raw.close(),
          onMessage: (listener) => raw.on("message", (data, isBinary) => {
            if (!isBinary) listener(String(data));
          }),
          onClose: (listener) => raw.once("close", listener),
        });
        connection.onRequest = this.onRequest;
        connection.onNotification = this.options.onNotification;
        const closed = new Promise<void>((resolve) => { connection.onClose = resolve; });
        resolve({ connection, closed });
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  private async watchRegistry(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.subscribeRegistry(signal);
      } catch (error) {
        if (!signal.aborted) this.log(`${this.url.origin} registry: ${error}`);
      }
      this.catalog = [];
      if (!signal.aborted) await delay(500, undefined, { signal }).catch(() => {});
    }
  }

  private async subscribeRegistry(session: AbortSignal): Promise<void> {
    const subscription = new AbortController();
    const signal = AbortSignal.any([session, subscription.signal]);
    let refresh: Promise<void> | undefined;
    let refreshRequested = false;

    // 通知は差分ではないため、取得中に届いた分は次の1回にまとめる（contracts/00004）。
    const refreshCatalog = async () => {
      try {
        while (refreshRequested && !signal.aborted) {
          refreshRequested = false;
          const snapshot = await this.request("GET", "/registry", AbortSignal.any([signal, AbortSignal.timeout(5000)]));
          const registry = registrySnapshotSchema.parse(await snapshot.json());
          signal.throwIfAborted();
          this.catalog = registry.registrations.filter((entry) => entry.rpcAvailable).flatMap((entry) =>
            entry.tools.map((tool) => ({ ...tool, registrationId: entry.registrationId, pluginId: entry.pluginId })));
        }
      } catch (error) {
        if (!signal.aborted) subscription.abort(error);
      } finally {
        refresh = undefined;
      }
    };

    try {
      const response = await this.request("GET", "/events", signal);
      if (!response.body) throw new Error("missing SSE stream");
      await readRegistryChanges(response.body, () => {
        if (signal.aborted) return;
        refreshRequested = true;
        refresh ??= refreshCatalog();
      });
      subscription.signal.throwIfAborted();
    } finally {
      // 古い購読で始めた取得結果を、次の購読に持ち越さない。
      subscription.abort();
      await refresh;
    }
  }
}

async function readRegistryChanges(stream: NonNullable<Response["body"]>, onChange: () => void): Promise<void> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  try {
    let buffer = "";
    let hasEvent = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      const lines = (buffer + value).split("\n");
      buffer = lines.pop() ?? "";
      if (buffer.length > 8192) throw new Error("SSE line too large");
      for (const line of lines) {
        if (line.length > 8192) throw new Error("SSE line too large");
        if (line.startsWith("event:")) hasEvent = true;
        if ((line === "" || line === "\r") && hasEvent) {
          hasEvent = false;
          onChange();
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
