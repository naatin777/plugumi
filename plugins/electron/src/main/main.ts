// Electron Pluginのmainプロセス。Coreへ接続するのはhost（plugumi-web）で、
// Electronはその配る画面をBrowserWindowで開くだけのviewer（decisions/00015）。
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { app, BrowserWindow, ipcMain } from "electron";
import { parseCoreArgs } from "./args.js";
import { findHost, recordsDir, spawnHost } from "./host.js";
import { register as registerInstance } from "./instances.js";

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
  const instanceId = `plugin-${randomUUID()}`;
  let unregister = () => {};
  try {
    unregister = registerInstance(recordsDir(), instanceId);
  } catch {
    unregister = () => {};
  }

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
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    // detachedはrouteのpath+queryをそのまま開く。browserHistoryなので
    // /api・/ui以外のパスはhostがindex.htmlへフォールバックする。
    await window.loadURL(path === undefined ? hostURL : hostURL + path);
    return window;
  };
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
    if (typeof path === "string" && path.startsWith("/")) void createWindow(path);
  });
  await createWindow();

  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", () => {
    unregister();
    spawned?.kill();
  });
}

app.whenReady().then(start, (error) => {
  console.error(`[electron] startup failed: ${error}`);
  app.quit();
});
