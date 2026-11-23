/// <reference lib="dom" />
// contextBridge越しにShellHost相当の呼び出しをrendererへ出す。
// contextIsolationを有効にし、rendererからNodeへは触れさせない。
import { contextBridge, ipcRenderer } from "electron";

// structured cloneはSolidのproxyを受け付けないため、オブジェクト引数は
// JSON経由で素の形にしてから送る（web側のJSON.stringifyと同じ効果）。
const plain = (value: unknown): unknown =>
  value !== null && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value;

const invoke = (method: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke("shell", method, args.map(plain));

// rendererのテーマ変更をmainへ転送し、titleBarOverlayの色を合わせる。
// DOMイベントはisolated worldを越えるのでcontextBridgeを経由しなくても届く。
window.addEventListener("plugumi:theme", () => {
  ipcRenderer.send("plugumi:theme", document.documentElement.getAttribute("data-plugumi-theme") ?? "");
});

contextBridge.exposeInMainWorld("plugumiShell", {
  listCores: () => invoke("listCores"),
  getCore: (key: string) => invoke("getCore", key),
  addCore: (url: string) => invoke("addCore", url),
  removeCore: (url: string) => invoke("removeCore", url),
  listPanels: (key: string) => invoke("listPanels", key),
  callTool: (key: string, body: unknown) => invoke("callTool", key, body),
  listProjects: (key: string) => invoke("listProjects", key),
  createProject: (key: string, name: string) => invoke("createProject", key, name),
  deleteProject: (key: string, project: string) => invoke("deleteProject", key, project),
  createArea: (key: string, project: string, parent: string[], name: string) =>
    invoke("createArea", key, project, parent, name),
  deleteArea: (key: string, project: string, areaPath: string[]) =>
    invoke("deleteArea", key, project, areaPath),
  getWorkspace: (key: string, project: string, areaPath: string[]) =>
    invoke("getWorkspace", key, project, areaPath),
  putWorkspace: (key: string, project: string, areaPath: string[], workspace: unknown) =>
    invoke("putWorkspace", key, project, areaPath, workspace),
});
