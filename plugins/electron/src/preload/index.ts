/// <reference lib="dom" />
// host（plugumi-web）が配るShell画面へ、別window起動とテーマ通知だけを
// 橋渡しする。contextIsolationを有効にし、rendererからNodeへは触れさせない。
import { contextBridge, ipcRenderer } from "electron";

// rendererのテーマ変更をmainへ転送し、titleBarOverlayの色を合わせる。
// DOMイベントはisolated worldを越えるのでcontextBridgeを経由しなくても届く。
window.addEventListener("plugumi:theme", () => {
  ipcRenderer.send("plugumi:theme", document.documentElement.getAttribute("data-plugumi-theme") ?? "");
});

// Areaのdetach用の別window。mainがhost URLでBrowserWindowを開く。
contextBridge.exposeInMainWorld("plugumiWindows", {
  open: (path: string) => ipcRenderer.send("plugumi:open-window", path),
});
