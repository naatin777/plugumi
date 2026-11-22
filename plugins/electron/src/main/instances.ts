// Pluginのローカル実行記録（<cache>/plugumi/plugins/<id>.json。
// web pluginのplugininstancesと同じ形。Coreのpsが読む）。
import { mkdirSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "0.1.0";
const HEARTBEAT_MS = 5000;

interface Record {
  name: string;
  id: string;
  version: string;
  pid: number;
  heartbeatUnixSeconds: number;
}

// register は実行記録を書き、5秒ごとのheartbeat更新を返す。解除関数は
// 記録を削除する。記録先が使えなくてもPlugin自体は動かすため失敗してもよい。
export function register(directory: string, id: string): () => void {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch {
    return () => {};
  }
  const path = join(directory, `${id}.json`);
  const temporary = join(directory, `.${process.pid}`);
  const entry: Record = { name: "electron", id, version: VERSION, pid: process.pid, heartbeatUnixSeconds: 0 };
  // 読みかけの不完全ファイルを見せないよう、別名で書いてからrenameする。
  const heartbeat = () => {
    try {
      entry.heartbeatUnixSeconds = Math.floor(Date.now() / 1000);
      writeFileSync(temporary, JSON.stringify(entry), { mode: 0o600 });
      renameSync(temporary, path);
    } catch {
      // heartbeat失敗はpsの表示が古くなるだけなので無視する。
    }
  };
  heartbeat();
  const timer = setInterval(heartbeat, HEARTBEAT_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    rmSync(path, { force: true });
  };
}
