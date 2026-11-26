// Electron Pluginのmainプロセス。host（plugumi-web）が配る画面を
// BrowserWindowで開くviewerであり、同時に内部ブラウザ由来のToolを
// hostのCoreへ登録するPluginでもある（decisions/00015）。
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { app, BrowserWindow, ipcMain } from "electron";
import { loadUI, newInstanceId, registerPlugin } from "plugumi-plugin-client";
import type { UI } from "plugumi-plugin-client";
import { parseCoreArgs } from "./args.js";
import { findHost, spawnHost } from "./host.js";
import { followHostCores } from "./cores.js";
import { Windows } from "./windows.js";
import { windowTools } from "./tools.js";

// OS領域の帯（shellのenv(titlebar-area-height)既定値）に合わせる。
// 色はテーマ連動（rendererのplugumi:theme通知でsetTitleBarOverlayする）。
const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLORS: Record<string, { color: string; symbolColor: string }> = {
  dark: { color: "#080808", symbolColor: "#e6e6e6" },
  light: { color: "#f7f7f7", symbolColor: "#1a1a1a" },
};

async function start(): Promise<void> {
  const commandURLs = parseCoreArgs(process.argv.slice(app.isPackaged ? 1 : 2));

  // 実行記録（<cache>/plugumi/plugins/<id>.json）。失敗しても動かす。
  const instanceId = newInstanceId();
  const unregister = registerPlugin({
    name: "electron", id: instanceId, version: "0.1.0", pid: process.pid,
  }) ?? (() => {});

  // 既に動いているhostがあればそれを使い、無ければplugumi-webを子プロセス
  // として起動する。再利用したhostは終了時に止めない。
  let spawned: ChildProcess | undefined;
  let hostURL = await findHost();
  if (hostURL === undefined) {
    const host = await spawnHost(commandURLs);
    hostURL = host.url;
    spawned = host.process;
    // 自分が起動したhostが死んだらviewerだけ残しても使えないので閉じる。
    spawned.once("exit", () => app.quit());
  }

  const createWindow = async (path?: string): Promise<BrowserWindow> => {
    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      titleBarStyle: "hidden",
      titleBarOverlay: { ...TITLEBAR_COLORS.dark, height: TITLEBAR_HEIGHT },
      // 窓の後ろ側（デスクトップ）をネイティブのぼかしマテリアルで
      // 透かす。shell側のframe色が透過な所だけ見える。
      vibrancy: "fullscreen-ui",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        sandbox: true,
        // Site Panelが<webview>で外部サイトをDOM内に埋め込むために要る。
        webviewTag: true,
      },
    });
    // detachedはrouteのpath+queryをそのまま開く。browserHistoryなので
    // /api・/ui以外のパスはhostがindex.htmlへフォールバックする。
    await window.loadURL(path === undefined ? hostURL : hostURL + path);
    return window;
  };
  const windows = new Windows(createWindow);

  // <webview>のguestがwindow.openやtarget=_blankで新しいwindowを要求した
  // とき — Electronのpopupは作らず、要求元のSite PanelへURLを中継する
  // （同じleafに新しいSite Panelとして開く。context.openPanel経由）。
  // guestのwebContentsにはrendererから触れないのでapp単位で張る。
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send("plugumi:site-open", { guestId: contents.id, url });
        }
      }
      return { action: "deny" };
    });
  });

  ipcMain.on("plugumi:theme", (event, theme: unknown) => {
    // setTitleBarOverlayはWindows/Linux専用。macOSにはメソッド自体が
    // 存在しないので呼ぶと例外になる（hiddenInsetで十分なため不要）。
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || typeof window.setTitleBarOverlay !== "function") return;
    const colors = TITLEBAR_COLORS[String(theme)] ?? TITLEBAR_COLORS.dark;
    window.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
  });
  // Areaを別windowに出す（detach）要求。
  ipcMain.on("plugumi:open-window", (_event, path: unknown) => {
    if (typeof path === "string" && path.startsWith("/")) void windows.open(path);
  });
  // 内部ブラウザ由来のToolとPanelをhostのCoreへ登録する。windowとは
  // 独立に動かし、Coreの増減はhostの/api/coresに追従する。
  // UI bundle（ui/dist）は未buildならPanel無しで動かす。
  let ui: UI | undefined;
  try {
    ui = loadUI(join(__dirname, "..", "..", "ui", "dist"));
  } catch {
    console.error("[electron] UI bundleがありません（apps/electron/uiでpnpm buildするとPanelが登録されます）");
  }
  const cores = new AbortController();
  followHostCores(hostURL, instanceId, windowTools(windows), ui, cores.signal);

  await windows.open();

  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", () => {
    cores.abort();
    unregister();
    spawned?.kill();
  });
}

app.whenReady().then(start, (error) => {
  console.error(`[electron] startup failed: ${error}`);
  app.quit();
});
