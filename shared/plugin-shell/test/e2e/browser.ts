// E2E共通: programmaticなVite dev server（空きport自動選択・常駐させない）
// と agent-browser CLIのwrapper。ブラウザ操作は全てheadless。
// 全て非同期 — execFileSync等でevent loopを止めると、同じprocess内の
// Vite serverが応答できずbrowser側のloadが完了しなくなる。
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "vite";

const LOG = process.env.E2E_LOG;
const log = (msg: string) => {
  if (LOG) appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${msg}\n`);
};

const SESSION = "plugumi-e2e";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (args: string[], timeout: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      "agent-browser",
      ["--session", SESSION, ...args],
      { encoding: "utf8", timeout },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

const isDaemonBusy = (cause: unknown): boolean =>
  String((cause as { stderr?: string })?.stderr ?? cause)
    .includes("no response came back");

// daemonはcommandを直列にさばき、処理中は他のCLI呼び出しが全て
// EAGAIN で即失敗する。browser launch・長いloadなどで数十秒busyに
// なるので、安いevalで応答が戻るまで待って本commandを叩き直す。
// workerが戻ってこない場合は close --all でsessionを殺してやり直す
// — closeはworkerが詰まっていても通る。
const daemonAlive = async (): Promise<boolean> => {
  try {
    await run(["eval", "1"], 60000);
    return true;
  } catch (cause) {
    if (isDaemonBusy(cause)) return false;
    throw cause;
  }
};

const killSession = async () => {
  try {
    await run(["close", "--all"], 30000);
  } catch { /* 既に死んでいてもよい */ }
};

export async function ab(args: string[]): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      log(`cmd: ${args.join(" ")}`);
      return await run(args, 120000);
    } catch (cause) {
      last = cause;
      if (!isDaemonBusy(cause)) throw cause;
      log(`busy: ${args.join(" ")} attempt=${attempt}`);
      for (let i = 0; i < 60 && !(await daemonAlive()); i++) await sleep(2000);
      if (!(await daemonAlive())) { log("killSession"); await killSession(); }
      await sleep(1000);
    }
  }
  throw last;
}

export async function abEval<T = unknown>(expr: string): Promise<T> {
  // daemonはeval結果をJSON encodeして返す。objectはpretty printで複数行に
  // なるので、こちらでJSON.stringifyして1行にしておき、両方parseで剥がす。
  const out = await ab(["eval", `JSON.stringify((${expr}))`]);
  const line = out.trim().split("\n").filter(Boolean).pop() ?? "null";
  const first = JSON.parse(line) as unknown;
  if (typeof first !== "string") return first as T;
  try {
    return JSON.parse(first) as T;
  } catch {
    return first as T;
  }
}

// 初回loadはentryのtransform＋依存prebundleが走ってページが数分固まり、
// daemonのtab watchdogがtabを殺す。開く前にmodule graphをHTTPで全fetch
// してserver側に全transformとdep bundlingを終わらせる。
const IMPORT_RE = /from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

const warmGraph = async (base: string): Promise<void> => {
  const seen = new Set<string>();
  const crawl = async () => {
    const queue = ["/main.tsx"];
    while (queue.length > 0 && seen.size < 4000) {
      const next = queue.shift() ?? "";
      if (seen.has(next)) continue;
      seen.add(next);
      const res = await fetch(base + next.slice(1)).catch(() => null);
      if (!res?.ok) continue;
      const text = await res.text();
      for (const match of text.matchAll(IMPORT_RE)) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (spec?.startsWith("/")) queue.push(spec);
      }
    }
  };
  await crawl();
  // dep prebundleは初回だけ数分かかる。deps URLはbundle完了まで
  // 200を返さないので、1本でも通るまで待てばbundle終了の合図になる。
  const dep = [...seen].find((u) => u.includes("/.vite/deps/"));
  if (dep) {
    const deadline = Date.now() + 600000;
    for (;;) {
      const res = await fetch(base + dep.slice(1)).catch(() => null);
      if (res?.ok) break;
      if (Date.now() > deadline) throw new Error("dep prebundleが終わりません");
      await sleep(2000);
    }
    // bundle commitでdepsの?v= hashが変わるのでgraphを辿り直す。
    await crawl();
  }
};

export async function startServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = await createServer({
    configFile: new URL("../vite.config.ts", import.meta.url).pathname,
    server: { port: 0 },
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("vite server URLが取れません");
  await warmGraph(url);
  const idle = (server as { waitForRequestsIdle?: () => Promise<void> })
    .waitForRequestsIdle;
  if (idle) await idle.call(server);
  return { url, close: () => server.close() };
}

// 遷移は `open`/`reload` に任せる。evalで `location.href` を書き換えると
// navigationでcontextが消えてdaemonのworkerが応答不能になる。
const waitMounted = async () => {
  for (let i = 0; i < 120; i++) {
    try {
      const ready = await abEval<string>(`document.readyState`);
      const mounted = await abEval<boolean>(`!!document.querySelector('#root > *')`);
      if (ready === "complete" && mounted) return;
    } catch { /* 遷移中・daemon busy — poll継続 */ }
    await sleep(1000);
  }
  throw new Error("ページのloadが終わりません");
};

export async function openPage(url: string): Promise<void> {
  await ab(["open", url]);
  await waitMounted();
  await sleep(1500);
}

export async function reloadPage(): Promise<void> {
  await ab(["reload"]);
  await waitMounted();
  await sleep(1500);
}

// spec fileは並列で起動しうる。browser sessionは1つしかないので、
// file lockで直列化する。前回の残骸はmtimeで捨てる。
const LOCK = new URL("./out/.lock", import.meta.url).pathname;

export async function acquireBrowser(): Promise<void> {
  mkdirSync(new URL("./out/", import.meta.url).pathname, { recursive: true });
  for (;;) {
    try {
      mkdirSync(LOCK);
      return;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 20 * 60 * 1000) {
          rmSync(LOCK, { recursive: true });
          continue;
        }
      } catch { /* lockが消えたら次のloopで取る */ }
      await sleep(1000);
    }
  }
}

export function releaseBrowser(): void {
  try { rmSync(LOCK, { recursive: true }); } catch { /* 既に無い */ }
}

// 画面の状態を作るためのpage内script。clickは実DOM event。
export const PREPARE = (opts: { theme: string; sub: boolean; drawer: string }) => `
(() => {
  document.documentElement.dataset.plugumiTheme = ${JSON.stringify(opts.theme)};
  const btn = (label) => document.querySelector('button[aria-label="' + label + '"]');
  const click = (label) => { const b = btn(label); if (b) b.click(); };
  // Subの実効表示を合わせる。
  const subPane = document.querySelector('.sub-pane');
  if (subPane && subPane.hasAttribute('data-closed') === ${opts.sub}) click('Sub');
  // drawerは1つだけ開く（"none"は全部閉じる）。
  const kinds = { left: '左の領域', right: '右の領域', bottom: '下の領域' };
  const drawer = ${JSON.stringify(opts.drawer)};
  // Sub drawerは上で済ませた。sideはArea listボタン（drawerのときだけ）。
  const side = document.querySelector('.frame-side');
  const wantSide = drawer === 'side';
  if (side && side.hasAttribute('data-drawer')) {
    if (side.hasAttribute('data-closed') === wantSide) click('Area list');
  }
  // dockはdrawer化しているときだけ開閉を触る。drawerはCSS上
  // position:absolute（inlineはgrid/static）なのでcomputed styleで見分ける。
  for (const [kind, label] of Object.entries(kinds)) {
    const d = document.querySelector('.dock[data-dock="' + kind + '"]');
    if (!d || getComputedStyle(d).position !== 'absolute') continue;
    const want = drawer === kind;
    if (d.hasAttribute('data-closed') === want) click(label);
  }
  return true;
})()`;

// 記録対象のstyleプロパティ。
const STYLE_PROPS = [
  "background-color",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-radius", "box-shadow", "opacity", "visibility", "z-index", "color",
];

export const COLLECT = `
(() => {
  const props = ${JSON.stringify(STYLE_PROPS)};
  const slot = (el) =>
    el.closest('[data-part="sub-slot"]') ? 'sub' :
    el.closest('[data-part="area-list"]') ? 'side' : 'main';
  const list = [...document.querySelectorAll('[data-part]')].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const styles = {};
    for (const prop of props) styles[prop] = cs.getPropertyValue(prop);
    return {
      part: el.dataset.part,
      dock: el.dataset.dock ?? '',
      divider: el.dataset.divider ?? '',
      slot: slot(el),
      rect: [r.x, r.y, r.width, r.height].map((v) => Math.round(v)),
      styles,
    };
  });
  const counts = {};
  return list.map((item) => {
    const base = [item.part, item.dock, item.divider, item.slot].join('|');
    counts[base] = (counts[base] ?? 0) + 1;
    return { key: base + '#' + counts[base], rect: item.rect, styles: item.styles };
  }).sort((a, b) => a.key < b.key ? -1 : 1);
})()`;
