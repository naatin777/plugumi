// ShellHost のIPC実装。preloadがwindow.plugumiShellに出す窓口を呼び、
// uiURLはplugumi-ui://のURLを組み立てるだけなのでここで実装する。
import type {
  CallToolBody, CoreEntry, PanelEntry, ProjectTree,
  ShellHost, WorkspaceState,
} from "@plugumi/plugin-shell";

// preloadが出す窓口。ShellHostからuiURLを除いた形。
interface PlugumiShellBridge {
  listCores(): Promise<CoreEntry[]>;
  getCore(key: string): Promise<CoreEntry>;
  addCore(url: string): Promise<void>;
  removeCore(url: string): Promise<void>;
  listPanels(key: string): Promise<PanelEntry[]>;
  callTool(key: string, body: CallToolBody): Promise<unknown>;
  listProjects(key: string): Promise<ProjectTree[]>;
  createProject(key: string, name: string): Promise<void>;
  deleteProject(key: string, project: string): Promise<void>;
  createArea(key: string, project: string, parent: string[], name: string): Promise<void>;
  deleteArea(key: string, project: string, areaPath: string[]): Promise<void>;
  getWorkspace(key: string, project: string, areaPath: string[]): Promise<unknown>;
  putWorkspace(key: string, project: string, areaPath: string[], workspace: WorkspaceState): Promise<void>;
  openWindow(path: string): void;
}

declare global {
  interface Window {
    plugumiShell: PlugumiShellBridge;
  }
}

// ipcRenderer.invokeのErrorは「Error invoking remote method ...」の
// 接頭辞が付く。画面にはBackendが投げた本体だけを見せる。
function unwrap(message: string): string {
  const match = /Error invoking remote method '[^']+': (?:Error: )?(.*)$/s.exec(message);
  return match ? match[1] : message;
}

// contextBridge境界はstructuredClone相当のコピーをする。Solidのstore proxyは
// cloneできず「An object could not be cloned」になるため、オブジェクト引数は
// JSON経由で素の形にする（web側のJSON.stringifyと同じ効果）。
function plain<T>(value: T): T {
  return (value !== null && typeof value === "object"
    ? JSON.parse(JSON.stringify(value)) : value) as T;
}

function wrap<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    throw new Error(unwrap(error instanceof Error ? error.message : String(error)));
  });
}

export function ipcShellHost(): ShellHost {
  const bridge = window.plugumiShell;
  return {
    listCores: () => wrap(bridge.listCores()),
    getCore: (key) => wrap(bridge.getCore(key)),
    addCore: (url) => wrap(bridge.addCore(url)),
    removeCore: (url) => wrap(bridge.removeCore(url)),
    listPanels: (key) => wrap(bridge.listPanels(key)),
    callTool: (key, body) => wrap(bridge.callTool(key, plain(body))),
    listProjects: (key) => wrap(bridge.listProjects(key)),
    createProject: (key, name) => wrap(bridge.createProject(key, name)),
    deleteProject: (key, project) => wrap(bridge.deleteProject(key, project)),
    createArea: (key, project, parent, name) =>
      wrap(bridge.createArea(key, project, plain(parent), name)),
    deleteArea: (key, project, areaPath) => wrap(bridge.deleteArea(key, project, plain(areaPath))),
    getWorkspace: (key, project, areaPath) => wrap(bridge.getWorkspace(key, project, plain(areaPath))),
    putWorkspace: (key, project, areaPath, workspace) =>
      wrap(bridge.putWorkspace(key, project, plain(areaPath), plain(workspace))),
    // mainのprotocol.handle("plugumi-ui")が受ける。host=key、
    // path=/<registrationId>/<file>。?vはmanifest変更時のcache-buster。
    uiURL: (coreKey, registrationId, path, uiSha256) =>
      `plugumi-ui://${encodeURIComponent(coreKey)}/${encodeURIComponent(registrationId)}` +
      `/${path}?v=${uiSha256}`,
    openWindow: (path) => bridge.openWindow(path),
  };
}
