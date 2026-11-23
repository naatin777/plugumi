// plugumi-web hostの発見と起動。hostは実行記録（<cache>/plugumi/plugins/
// <id>.json）に待受URLをurlとして書くので、記録をscanして疎通できるものを
// 再利用し、無ければplugumi-webを子プロセスとして起動する。
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// os.UserCacheDirに相当する場所（macOSは~/Library/Caches、LinuxはXDG、
// WindowsはLOCALAPPDATA）。web pluginのplugininstancesと同じ基準。
export function cacheDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches");
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  }
  return process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

// 実行記録の置き場。plugininstances（Go）・instances.ts（Electron）と同じ。
export function recordsDir(): string {
  return join(cacheDir(), "plugumi", "plugins");
}

// 実行記録のうち必要な部分だけ。urlを持つのは待受を立てるweb pluginだけ。
interface InstanceRecord {
  name?: string;
  pid?: number;
  url?: string;
}

// webRecords はname:"web"でurlを持つ実行記録を返す。
function webRecords(): { pid: number; url: string }[] {
  let names: string[];
  try {
    names = readdirSync(recordsDir());
  } catch {
    return [];
  }
  const found: { pid: number; url: string }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(readFileSync(join(recordsDir(), name), "utf8")) as InstanceRecord;
      if (entry.name === "web" && typeof entry.url === "string" && entry.url !== "") {
        found.push({ pid: entry.pid ?? 0, url: entry.url });
      }
    } catch {
      // 書きかけ・壊れた記録は読み飛ばす。
    }
  }
  return found;
}

// reachable は/api/coresへ200が返るかだけを見る疎通確認。
async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/cores`, { signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

// findHost は実行記録から生きたhostを探す。見つからなければundefined。
export async function findHost(): Promise<string | undefined> {
  for (const record of webRecords()) {
    if (await reachable(record.url)) return record.url;
  }
  return undefined;
}

export interface SpawnedHost {
  url: string;
  process: ChildProcess;
}

// spawnHost はplugumi-webを子プロセスとして起動し、実行記録にurlが
// 現れて疎通できるまで待つ。--coreは起動引数をそのまま転送し、
// PLUGUMI_TOKEN・PLUGUMI_CORE_URLは環境変数ごと引き継がれる。
export async function spawnHost(coreURLs: string[]): Promise<SpawnedHost> {
  const binary = await hostBinary();
  const args = ["--listen", "127.0.0.1:0"];
  for (const url of coreURLs) args.push("--core", url);
  const child = spawn(binary, args, { stdio: ["ignore", "inherit", "inherit"] });
  const url = await waitForRecord(child);
  return { url, process: child };
}

// waitForRecord は子プロセスのpidを持つ実行記録にurlが現れるまで待つ。
// 記録のファイル名は子プロセスが決めるidなので、pidで自分の子を見分ける。
function waitForRecord(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    let settled = false;
    const finish = (error?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve(url!);
    };
    const onExit = (code: number | null) => {
      finish(new Error(`plugumi-web exited before writing its record (code ${code})`));
    };
    child.once("exit", onExit);
    const poll = async () => {
      for (const record of webRecords()) {
        if (record.pid === child.pid && (await reachable(record.url))) {
          finish(undefined, record.url);
          return;
        }
      }
      if (settled) return;
      if (Date.now() > deadline) {
        finish(new Error("plugumi-webの実行記録にurlが現れませんでした"));
        return;
      }
      setTimeout(poll, 100);
    };
    void poll();
  });
}

// hostBinary はplugumi-webバイナリの位置を返す。PLUGUMI_HOST_BINがあれば
// それを使い、無ければリポジトリからcacheへbuildする（開発用）。
// リポジトリはPLUGUMI_REPO、無ければdist/mainからの相対位置で決める。
async function hostBinary(): Promise<string> {
  if (process.env.PLUGUMI_HOST_BIN) return process.env.PLUGUMI_HOST_BIN;
  const repository = process.env.PLUGUMI_REPO ?? join(__dirname, "..", "..", "..", "..");
  const webDirectory = join(repository, "plugins", "web");
  if (!existsSync(join(webDirectory, "cmd", "plugumi-web", "main.go"))) {
    throw new Error(
      "plugumi-webのソースが見つかりません。PLUGUMI_HOST_BINかPLUGUMI_REPOを指定してください",
    );
  }
  const directory = join(cacheDir(), "plugumi", "host");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const binary = join(directory, process.platform === "win32" ? "plugumi-web.exe" : "plugumi-web");
  try {
    await execFileAsync("go", ["build", "-o", binary, "./cmd/plugumi-web"], { cwd: webDirectory });
  } catch (error) {
    throw new Error(
      `plugumi-webのbuildに失敗しました: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return binary;
}
