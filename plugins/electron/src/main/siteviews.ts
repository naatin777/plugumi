// Panel領域へ貼るWebContentsViewの管理。rendererのPanelはプレースホルダの
// rectを報告し、mainがviewをその位置に重ねる（Panelの中身はDOMではなく
// 別webContents。ShellのShadow DOMを越えて正しく合成される）。
// rectはviewport基準のCSS px — 全画面webContentsの直下の子viewなので
// windowのcontentView座標と一致する。
import { BrowserWindow, WebContentsView, ipcMain } from "electron";
import type { IpcMainEvent } from "electron";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SiteView {
  view: WebContentsView;
  window: BrowserWindow;
}

const views = new Map<string, SiteView>();

// viewに触れてよいURLはhttp(s)だけ（file:や独自schemeは開かせない）。
function httpURL(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function rect(value: unknown): Rect | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { x, y, width, height } = value as Record<string, unknown>;
  if ([x, y, width, height].some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return undefined;
  }
  return { x, y, width, height } as Rect;
}

function destroy(id: string): void {
  const site = views.get(id);
  if (!site) return;
  views.delete(id);
  if (!site.window.isDestroyed()) {
    site.window.contentView.removeChildView(site.view);
  }
  site.view.webContents.close();
}

export function registerSiteHandlers(): void {
  // attachは新しいviewをsenderのwindowに貼る。Panelはmount時に1回呼ぶ。
  ipcMain.on("plugumi:site-attach", (event: IpcMainEvent, id: unknown, url: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const target = httpURL(url);
    if (!window || typeof id !== "string" || id === "" || views.has(id)) return;
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    window.contentView.addChildView(view);
    if (target !== undefined) void view.webContents.loadURL(target);
    views.set(id, { view, window });
    // ownerのwindowかrendererが死んだらviewも片付ける。
    event.sender.once("destroyed", () => destroy(id));
    window.once("closed", () => views.delete(id));
  });

  // boundsはrect報告。サイズ0ならviewを隠す（スクロールで見切れた等）。
  ipcMain.on("plugumi:site-bounds", (_event: IpcMainEvent, id: unknown, value: unknown) => {
    const site = typeof id === "string" ? views.get(id) : undefined;
    const bounds = rect(value);
    if (!site || !bounds || site.window.isDestroyed()) return;
    const visible = bounds.width > 0 && bounds.height > 0;
    site.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.round(bounds.width), height: Math.round(bounds.height) });
    site.view.setVisible(visible);
  });

  ipcMain.on("plugumi:site-navigate", (_event: IpcMainEvent, id: unknown, url: unknown) => {
    const site = typeof id === "string" ? views.get(id) : undefined;
    const target = httpURL(url);
    if (!site || !target || site.window.isDestroyed()) return;
    void site.view.webContents.loadURL(target);
  });

  ipcMain.on("plugumi:site-detach", (_event: IpcMainEvent, id: unknown) => {
    if (typeof id === "string") destroy(id);
  });
}
