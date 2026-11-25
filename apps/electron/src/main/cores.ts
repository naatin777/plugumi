// hostが繋がっているCoreへelectronをTool providerとして登録する。
// viewerが開いているhostの画面をこのwindowが映すので、繋ぐCoreも
// hostの /api/cores に合わせ、一覧の増減は定期追従する。
import { coreURL, PluginClient } from "plugumi-plugin-client";
import type { Tool, UI } from "plugumi-plugin-client";

const POLL_MS = 5000;

interface CoreEntry {
  url?: string;
}

// hostの/api/coresを定期取得し、originごとにPluginClientを対応させる。
// 取得に失敗した回は既存clientを維持する（host再起動中の瞬断で
// 登録を落とさないため）。
export function followHostCores(
  hostURL: string, instanceId: string, tools: Tool[], ui: UI | undefined,
  signal: AbortSignal,
): void {
  const clients = new Map<string, AbortController>();

  const sync = async () => {
    let entries: unknown;
    try {
      const response = await fetch(`${hostURL}/api/cores`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return;
      entries = await response.json();
    } catch {
      return;
    }
    if (!Array.isArray(entries)) return;
    const wanted = new Set<string>();
    for (const entry of entries as CoreEntry[]) {
      if (typeof entry?.url !== "string") continue;
      try {
        wanted.add(new URL(entry.url).origin);
      } catch {
        // 不正なurlは読み飛ばす。
      }
    }
    for (const [origin, abort] of [...clients]) {
      if (!wanted.has(origin)) {
        abort.abort();
        clients.delete(origin);
      }
    }
    for (const origin of wanted) {
      if (clients.has(origin)) continue;
      const abort = new AbortController();
      clients.set(origin, abort);
      const client = new PluginClient({
        url: coreURL(origin),
        providerId: "electron",
        instanceId,
        token: process.env.PLUGUMI_TOKEN,
        tools,
        ui,
        log: (message) => console.error(`[electron] ${message}`),
      });
      void client.run(AbortSignal.any([signal, abort.signal])).then((outcome) => {
        if (outcome === "rejected") {
          console.error(`[electron] ${origin}: 登録が拒否されました`);
        }
      });
    }
  };

  void sync();
  const timer = setInterval(() => void sync(), POLL_MS);
  const onAbort = () => {
    clearInterval(timer);
    for (const abort of clients.values()) abort.abort();
    clients.clear();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
}
