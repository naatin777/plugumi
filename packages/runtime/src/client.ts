// Coreへの登録・operation宣言・WS接続のsession（contracts/00004）。
// 1インスタンスが1つのCoreに対応し、切断しても再登録を繰り返す。
// 登録フロー: POST registrations → PUT operations → PUT ui → POST ready → WS。

import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { scanUI, serveAsset, validatePanels } from "./assets.js";
import type { UI, UIManifest, UIFileEntry } from "./assets.js";
import { ActiveExecutions } from "./execution.js";
import { declarations, dispatchInvoke, invalidParams } from "./operations.js";
import type { Operation } from "./operations.js";
import { Connection } from "./rpc.js";
import type { Socket } from "./rpc.js";
import {
  METHOD_ASSETS_GET,
  METHOD_EXECUTIONS_CANCEL,
  METHOD_OPERATIONS_INVOKE,
  isNotification,
  isRequest,
} from "./wire.js";
import type { ForwardInvokeParams, Incoming, RegistrationLease, RpcError } from "./wire.js";

const API = "/v1";

class CoreHTTPError extends Error {
  constructor(readonly status: number, method: string, path: string) {
    super(`${method} ${path}: HTTP ${status}`);
  }
}

export function coreURL(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Core URL must be an HTTP(S) origin");
  }
  return url;
}

export interface PluginRuntimeOptions {
  url: URL;
  providerId: string;
  instanceId: string;
  // 所属。environmentはenv ref（例: "env/local"）、hostSessionはhost session ref。
  // 両方は指定できない。どちらもなければglobal / serviceとして扱われる。
  environment?: string;
  hostSession?: string;
  // PLUGUMI_TOKENに対応するBearer資格情報（Coreに設定されている場合必須）。
  token?: string;
  // 提供するoperation。operations.invokeのdispatchはこれから自動で作る。
  operations?: readonly Operation[];
  // 提供するUI。manifestの宣言とassets.get応答を自動で行う。
  ui?: UI;
  log?: (message: string) => void;
}

export class PluginRuntime {
  connection?: Connection;
  private registrationId?: string;
  private readonly headers: Record<string, string>;
  private readonly log: (message: string) => void;
  private readonly active = new ActiveExecutions();
  private uiFiles?: Map<string, UIFileEntry>;
  private uiManifest?: UIManifest;

  constructor(readonly options: PluginRuntimeOptions) {
    if (options.environment && options.hostSession) {
      throw new Error("environment and hostSession are mutually exclusive");
    }
    this.headers = options.token ? { Authorization: `Bearer ${options.token}` } : {};
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
      if (this.registrationId) {
        await this.request("DELETE", `/registrations/${this.registrationId}`, signal).catch(() => {});
      }
    }
    return "stopped";
  }

  // 登録 → operations宣言 → UI manifest宣言 → ready。
  // いずれもlease内なら冪等なので、再接続のたびに同じ手順を踏む。
  private async prepare(signal: AbortSignal): Promise<RegistrationLease> {
    const registration = await this.request("POST", "/registrations", signal, {
      providerId: this.options.providerId,
      instanceId: this.options.instanceId,
      environment: this.options.environment,
      hostSession: this.options.hostSession,
    });
    const lease = (await registration.json()) as RegistrationLease;
    this.registrationId = lease.registrationId;
    const base = `/registrations/${lease.registrationId}`;
    if (this.options.operations) {
      await this.request("PUT", `${base}/operations`, signal, {
        operations: declarations(this.options.operations),
      });
    }
    if (this.options.ui) {
      const scanned = await scanUI(this.options.ui);
      const invalid = validatePanels(scanned.manifest);
      if (invalid) throw new Error(invalid);
      this.uiFiles = scanned.files;
      this.uiManifest = scanned.manifest;
      await this.request("PUT", `${base}/ui`, signal, scanned.manifest);
    }
    await this.request("POST", `${base}/ready`, signal);
    return lease;
  }

  private async runSession(signal: AbortSignal): Promise<void> {
    const lease = await this.prepare(signal);
    const wsURL = new URL(`${API}/rpc?registrationId=${lease.registrationId}`, this.url);
    wsURL.protocol = wsURL.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(wsURL, { headers: this.headers });
    const connection = Connection.attach(wrapSocket(socket));
    this.connection = connection;
    connection.onRequest = (message) => this.handleRequest(message);
    connection.onNotification = (message) => this.handleNotification(message);
    this.log(`connected to ${this.url.origin} (${lease.registrationId})`);

    const renew = lease.leaseSeconds / 2;
    let failure: Error | undefined;
    try {
      while (!signal.aborted) {
        const woke = await Promise.race([
          delay(renew * 1000, true, { signal }).catch(() => false),
          connection.closed.then(() => "closed" as const),
        ]);
        if (woke === "closed") throw new Error("connection closed");
        if (!woke) break;
        await this.request("POST", `/registrations/${lease.registrationId}/renew`, signal);
      }
    } catch (error) {
      failure = error as Error;
    }
    connection.close();
    if (failure && failure.message !== "connection closed" && !(failure instanceof CoreHTTPError)) {
      throw failure;
    }
    if (failure instanceof CoreHTTPError) throw failure;
    if (failure?.message === "connection closed") throw failure;
  }

  private async handleRequest(message: Incoming): Promise<{ result?: unknown; error?: RpcError }> {
    if (message.method === METHOD_OPERATIONS_INVOKE) {
      const params = message.params as ForwardInvokeParams | undefined;
      if (!params?.operation || !params.executionId) return invalidParams("invalid invoke params");
      return dispatchInvoke(this.active, this.connection!, this.options.operations ?? [], params);
    }
    if (message.method === METHOD_ASSETS_GET) {
      const params = message.params as { path?: string } | undefined;
      if (!params?.path || !this.uiFiles) return invalidParams("invalid assets.get params");
      const served = await serveAsset(this.uiFiles, params.path);
      // JSON-RPC responseのresultがAssetsGetResult（{content: base64}）になる。
      return "content" in served ? { result: { content: served.content } } : served;
    }
    return { error: { code: -32601, message: "method not found" } };
  }

  private handleNotification(message: Incoming): void {
    if (message.method === METHOD_EXECUTIONS_CANCEL) {
      const params = message.params as { executionId?: string } | undefined;
      if (params?.executionId) this.active.cancel(params.executionId);
    }
  }
}

// wsのWebSocketをrpc.tsの最小IFへ合わせる。
function wrapSocket(socket: WebSocket): Socket {
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(),
    onMessage: (listener) => socket.on("message", (data) => listener(data.toString())),
    onClose: (listener) => socket.on("close", listener),
  };
}
