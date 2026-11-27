// plugumi-web hostの発見と起動。hostは実行記録（<cache>/plugumi/plugins/
// <id>.json）に待受URLをurlとして書くので、記録をscanして疎通できるものを
// 再利用し、無ければplugumi-webを子プロセスとして起動する。
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { recordsDirectory } from "@plugumi/runtime";

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
    names = readdirSync(recordsDirectory());
  } catch {
    return [];
  }
  const found: { pid: number; url: string }[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const entry = JSON.parse(readFileSync(join(recordsDirectory(), name), "utf8")) as InstanceRecord;
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

// localStorageはportを含むorigin単位なので、毎回ランダムポートだと
// 起動のたびにprefs等が全消去される。既定ポートを優先して試し、
// 塞がっていれば（別process・古いwebが居る）：0へ落ちる。
const PREFERRED_LISTEN = "127.0.0.1:48007";

// spawnHost はplugumi-webを子プロセスとして起動し、実行記録にurlが
// 現れて疎通できるまで待つ。--coreは起動引数をそのまま転送し、
// PLUGUMI_TOKEN・PLUGUMI_CORE_URLは環境変数ごと引き継がれる。
export async function spawnHost(coreURLs: string[]): Promise<SpawnedHost> {
  const binary = hostBinary();
  try {
    return await spawnWithListen(binary, PREFERRED_LISTEN, coreURLs);
  } catch {
    return spawnWithListen(binary, "127.0.0.1:0", coreURLs);
  }
}

async function spawnWithListen(
  binary: string, listen: string, coreURLs: string[],
): Promise<SpawnedHost> {
  const args = ["--listen", listen];
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

// hostBinary はplugumi-webバイナリの位置を返す。リポジトリから暗黙に
// buildはしない — 実行マシンにGo toolchainやソース配置がある前提を作ると、
// 配布時の動作と開発時の動作が違って見えるため。
function hostBinary(): string {
  const binary = process.env.PLUGUMI_HOST_BIN;
  if (binary) return binary;
  throw new Error(
    "plugumi-webバイナリが指定されていません。PLUGUMI_HOST_BINを指定するか、先にWeb Workbench Hostを起動してください",
  );
}
