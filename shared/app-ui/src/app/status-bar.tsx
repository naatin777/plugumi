// status帯。左は接続状態の文字列、右はIndicatorの置き場所（未実装の枠だけ）。
import type { JSX } from "@solidjs/web";
import { useApp } from "./controller.tsx";
import "./status-bar.css";

const statusText = (status: string | undefined, error?: string): string => {
  switch (status) {
    case "connected": return "接続中";
    case "connecting": return "接続しています";
    case "rejected": return error ? `接続を拒否されました: ${error}` : "接続を拒否されました";
    case "unreachable": return "接続できません";
    default: return "確認しています";
  }
};

export function StatusBar(): JSX.Element {
  const app = useApp();
  return (
    <footer class={"status-bar"} data-part="statusbar">
      <span>{statusText(app.core()?.status, app.core()?.error)}</span>
      <span aria-hidden="true" />
    </footer>
  );
}
