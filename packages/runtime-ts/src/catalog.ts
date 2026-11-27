// Registry catalogの追跡。SSE feedで変更を受け取り、変わるたびに
// Snapshotを取り直す（contracts/00004）。SSEは変更通知だけで
// 内容を持たないので、正本は常にSnapshot側にある。

export interface CatalogOperation {
  path: string;
  description?: string;
  registrationId: string;
  providerId: string;
  environment?: string;
}

interface RegistrySnapshot {
  revision: string;
  registrations: {
    registrationId: string;
    providerId: string;
    environment?: string;
    ready?: boolean;
    operations?: { path: string; description?: string }[];
  }[];
}

import { setTimeout as delay } from "node:timers/promises";

export interface CatalogOptions {
  // Snapshot / SSEのGETに使うbase URLとheader。Coreへのアクセス情報。
  url: URL;
  headers: Record<string, string>;
  // catalogが変わるたびに呼ばれる。
  onChange?: (operations: CatalogOperation[]) => void;
  log?: (message: string) => void;
}

const API = "/v1";

export class Catalog {
  operations: CatalogOperation[] = [];

  constructor(private readonly options: CatalogOptions) {}

  private refreshing = false;
  private dirty = false;

  // SSE feedを追い続ける。切断されてもbackoffを置いて再接続し、
  // signalが止めるまで返らない。
  async run(signal: AbortSignal): Promise<void> {
    let backoff = 250;
    while (!signal.aborted) {
      try {
        await this.follow(signal);
        backoff = 250;
      } catch {
        // 接続切れ・parse失敗はいずれも再同期で復帰する。
      }
      if (signal.aborted) break;
      // SSEが切れた間の変更は追えないので、catalogは無効化する。
      // 空の一覧を信用して呼び出すより、ないことが分かるほうがよい。
      this.invalidate();
      // abortで即座に切れるdelayにしないと、client停止後も
      // timerが残ってprocessの終了を妨げる。
      await delay(backoff, undefined, { signal }).catch(() => {});
      backoff = Math.min(backoff * 2, 5_000);
    }
  }

  private invalidate(): void {
    this.operations = [];
    this.options.onChange?.(this.operations);
  }

  // Snapshot取得をsingle-flightで依頼する。進行中に重ねて通知が来ても
  // 追加分は1回にまとめる。通知バーストでSnapshot要求が倍増しない。
  private requestRefresh(signal: AbortSignal): void {
    if (this.refreshing) {
      this.dirty = true;
      return;
    }
    this.refreshing = true;
    void (async () => {
      try {
        do {
          this.dirty = false;
          await this.refresh(signal);
        } while (this.dirty && !signal.aborted);
      } catch {
        // 次の通知かSSE再接続で再同期する。
      } finally {
        this.refreshing = false;
      }
    })();
  }

  private async follow(signal: AbortSignal): Promise<void> {
    await this.refresh(signal);
    const response = await fetch(new URL(`${API}/events`, this.options.url), {
      signal, redirect: "error", headers: this.options.headers,
    });
    if (!response.ok || !response.body) throw new Error(`SSE: HTTP ${response.status}`);
    // SSE frameを行単位でparseし、registry系列のeventでSnapshotを取り直す。
    // execution系列（executions.event）はcatalogに関係しないので無視する。
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const eventLine = frame.split("\n").find((line) => line.startsWith("event: "));
        if (!eventLine) continue;
        const name = eventLine.slice("event: ".length).trim();
        if (name === "executions.event" || name === "") continue;
        this.requestRefresh(signal);
      }
    }
    // サーバーがSSEを閉じた場合も正常終了ではなく切断として扱い、
    // invalidationと再接続の経路へ乗せる。
    throw new Error("SSE stream ended");
  }

  private async refresh(signal: AbortSignal): Promise<void> {
    const response = await fetch(new URL(`${API}/registry`, this.options.url), {
      signal, redirect: "error", headers: this.options.headers,
    });
    if (!response.ok) throw new Error(`registry: HTTP ${response.status}`);
    const snapshot = (await response.json()) as RegistrySnapshot;
    this.operations = snapshot.registrations.flatMap((registration) =>
      (registration.operations ?? []).map((operation) => ({
        path: operation.path,
        description: operation.description,
        registrationId: registration.registrationId,
        providerId: registration.providerId,
        environment: registration.environment,
      })),
    );
    this.options.onChange?.(this.operations);
  }
}
