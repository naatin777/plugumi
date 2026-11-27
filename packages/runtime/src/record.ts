// 接続と独立したローカル実行記録。Coreのpsやhost発見が読む。
// 記録先はOSユーザーのキャッシュディレクトリで、特定のCoreとは無関係
// （<cache>/plugumi/plugins/<id>.json。Go側のplugininstancesと同じ形）。
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// プロセスごとの識別子。Coreのinstance id相当。opaqueなので形は問わない。
export function newInstanceId(): string {
  return `plugin-${randomUUID()}`;
}

// Go側のos.UserCacheDir()と同じ場所に揃える。
export function cacheDirectory(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches");
  }
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  }
  return process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

// 実行記録の置き場。plugininstances（Go）と同じ。
export function recordsDirectory(): string {
  return join(cacheDirectory(), "plugumi", "plugins");
}

export interface PluginRegistration {
  name: string;
  id: string;
  version?: string;
  pid: number;
  // 1プロセスが複数Coreに繋がるため、logはCoreではなくPluginの記録に持つ。
  log?: string;
  // 待受を立てるPlugin（web等）は疎通確認用のURLを載せる。
  url?: string;
}

// 登録に成功したら解除関数を返す。registryが使えない環境でもPlugin自体は動かす。
export function registerPlugin(registration: PluginRegistration): (() => void) | undefined {
  try {
    const directory = recordsDirectory();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, registration.id + ".json");
    // 読みかけの不完全ファイルを見せないよう、別名で書いてからrenameする。
    const temporary = join(directory, `.${process.pid}`);
    const heartbeat = () => {
      writeFileSync(
        temporary,
        JSON.stringify({ ...registration, heartbeatUnixSeconds: Math.floor(Date.now() / 1000) }),
        { mode: 0o600 },
      );
      renameSync(temporary, path);
    };
    heartbeat();
    const timer = setInterval(() => {
      try {
        heartbeat();
      } catch {}
    }, 5000);
    timer.unref();
    return () => {
      clearInterval(timer);
      try {
        rmSync(path, { force: true });
      } catch {}
    };
  } catch {
    return undefined;
  }
}
