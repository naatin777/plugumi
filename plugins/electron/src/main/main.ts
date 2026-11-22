// Electron Pluginのmainプロセス。PluginとしてCoreへ登録し、rendererに
// Plugin Shellを表示する。GoもHTTPサーバーも使わない（decisions/00015）。
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseCoreArgs } from "./args.js";
import { Backend, seedCores } from "./backend.js";
import { CoreManager, newInstanceId } from "./cores.js";
import { CoreStore } from "./core-store.js";
import { register as registerInstance } from "./instances.js";
import { registerIpc } from "./ipc.js";

// plugumi-ui:// を標準・安全・fetch/動的import可能なschemeとして登録する。
// app ready前に呼ぶ必要がある。
protocol.registerSchemesAsPrivileged([
  {
    scheme: "plugumi-ui",
    // fetch・動的importはCORSモードで投げられる。corsEnabledが無いと
    // Blinkがhandler到達前に止め、navigationでしか届かない。
    privileges: {
      standard: true, secure: true, supportFetchAPI: true,
      stream: true, corsEnabled: true, bypassCSP: true,
    },
  },
]);

// OS領域の帯（shellのenv(titlebar-area-height)既定値）に合わせる。
// 色はテーマ連動（rendererのplugumi:theme通知でsetTitleBarOverlayする）。
const TITLEBAR_HEIGHT = 40;
const TITLEBAR_COLORS: Record<string, { color: string; symbolColor: string }> = {
  dark: { color: "#080808", symbolColor: "#e6e6e6" },
  light: { color: "#f7f7f7", symbolColor: "#1a1a1a" },
};

// rendererからUIファイルを取る独自scheme。host=Coreのkey、
// path=/<registrationId>/<file>（rendererのipc-host.tsが組み立てる）。
const UI_SCHEME = "plugumi-ui";

// os.UserCacheDirに相当する場所（macOSは~/Library/Caches、LinuxはXDG、
// WindowsはLOCALAPPDATA）。web pluginのplugininstancesと同じ基準。
function cacheDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches");
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  }
  return process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

async function start(): Promise<void> {
  const commandURLs = parseCoreArgs(process.argv.slice(app.isPackaged ? 1 : 2));
  const token = process.env.PLUGUMI_TOKEN || undefined;
  const instanceId = newInstanceId();
  const manager = new CoreManager(instanceId, token);

  // Core一覧の保存先。<name>.jsonのProject保存（~/.plugumi/electron/）と
  // 混ざらないようappData側に置く（web pluginのconfig dirと同じ考え方）。
  let store: CoreStore | undefined;
  try {
    store = new CoreStore(join(app.getPath("appData"), "plugumi", "electron.json"));
    store.load();
  } catch {
    store = undefined;
  }
  seedCores(manager, store, commandURLs);

  const electronDir = join(homedir(), ".plugumi", "electron");
  const backend = new Backend(manager, store, electronDir, token);

  // 実行記録（<cache>/plugumi/plugins/<id>.json）。失敗しても動かす。
  let unregister = () => {};
  try {
    unregister = registerInstance(join(cacheDir(), "plugumi", "plugins"), instanceId);
  } catch {
    unregister = () => {};
  }

  protocol.handle(UI_SCHEME, (request) => backend.uiAsset(request));
  registerIpc(backend);

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
  ipcMain.on("plugumi:theme", (_event, theme: unknown) => {
    const colors = TITLEBAR_COLORS[String(theme)] ?? TITLEBAR_COLORS.dark;
    window.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
  });
  await window.loadFile(join(__dirname, "../renderer/index.html"));

  app.on("window-all-closed", () => {
    app.quit();
  });
  app.on("before-quit", () => {
    unregister();
    void backend.close();
  });
}

app.whenReady().then(start, (error) => {
  console.error(`[electron] startup failed: ${error}`);
  app.quit();
});
