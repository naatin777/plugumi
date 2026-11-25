/// <reference lib="dom" />
// host（plugumi-web）が配るShell画面へ、別window起動とテーマ通知だけを
// 橋渡しする。contextIsolationを有効にし、rendererからNodeへは触れさせない。
import { contextBridge, ipcRenderer } from "electron";

// この窓はvibrancy宿主 — CSSはbodyを透かし、frame色の向こうに
// デスクトップを見せる。ブラウザにはこの属性が無く不透明のまま。
document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.setAttribute("data-plugumi-vibrancy", "");
});

// rendererのテーマ変更をmainへ転送し、titleBarOverlayの色を合わせる。
// DOMイベントはisolated worldを越えるのでcontextBridgeを経由しなくても届く。
window.addEventListener("plugumi:theme", () => {
  ipcRenderer.send("plugumi:theme", document.documentElement.getAttribute("data-plugumi-theme") ?? "");
});

// Areaのdetach用の別window。mainがhost URLでBrowserWindowを開く。
contextBridge.exposeInMainWorld("plugumiWindows", {
  open: (path: string) => ipcRenderer.send("plugumi:open-window", path),
});

// <webview>のguestの新規window要求をSite Panelへ中継する。guestIdで
// どのwebviewの要求か分かるので全windowへばら撒き、受け手が選ぶ。
ipcRenderer.on("plugumi:site-open", (_event, detail) => {
  window.dispatchEvent(new CustomEvent("plugumi:site-open", { detail }));
});
