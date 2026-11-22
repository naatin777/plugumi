// Plugin Shell の画面が外（web pluginのサーバー、将来のElectron main等）と話す口。
// 画面側はこのinterfaceだけを使い、fetch先やURLの組み立ては宿主が実装する。
import { createContext, useContext, type ParentProps, type JSX } from "solid-js";

// ---- /api/cores 系の型（Go側のJSONフィールド名と一致） ----
export type CoreSource = "command" | "saved";
export type CoreStatus = "connecting" | "connected" | "rejected" | "unreachable";

export interface CoreEntry {
  url: string;
  source: CoreSource;
  coreId: string;
  name: string;
  key: string;
  status: CoreStatus;
  error?: string;
}

export interface PanelEntry {
  registrationId: string;
  pluginId: string;
  panelId: string;
  title: string;
  entry: string;
  styles: string[];
  uiSha256: string;
}

// ---- Project/Workspace 保存形式の型 ----
export interface PanelRef {
  instanceId: string;
  pluginId: string;
  panelId: string;
}

// Workspace(center)のレイアウト。splitは区画をx/yで分け、leafは中身の
// Panel群をdisplayで決めた形（tab stack / 横scroll帯 / pageめくり）に見せる。
export interface WsLeaf {
  kind: "leaf";
  id: string;
  panels: PanelRef[];
  selected: string;
  display: "tabs" | "scroll" | "pages";
}
export interface WsSplit {
  kind: "split";
  id: string;
  axis: "x" | "y";
  ratio: number;
  first: WsNode;
  second: WsNode;
}
export type WsNode = WsLeaf | WsSplit;

export interface Dock {
  panels: PanelRef[];
  selected: string;
  // Workspace(center)のみ。split treeのleafがdisplayを持つ。
  layout?: WsNode;
  // Shelfのみ: 積層sectionの状態（collapsed=折畳、grow=高さ比）。
  // 他dockはtab切替で同時表示しないのでsection概念を持たない。
  shelfSections?: Record<string, { collapsed?: boolean; grow?: number }>;
}

export interface Workspace {
  docks: { left: Dock; center: Dock; right: Dock; bottom: Dock };
}

export interface AreaTree {
  name: string;
  areas: AreaTree[];
}

export interface ProjectTree {
  name: string;
  areas: AreaTree[];
}

export interface CallToolBody {
  registrationId: string;
  toolPath: string;
  input: unknown;
}

export interface ShellHost {
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
  getShelf(key: string, project: string): Promise<Dock>;
  putShelf(key: string, project: string, dock: Dock): Promise<void>;
  getWorkspace(key: string, project: string, areaPath: string[]): Promise<Workspace>;
  putWorkspace(key: string, project: string, areaPath: string[], workspace: Workspace): Promise<void>;

  // Panel の entry/styles を取るURL。web は /ui/<key>/<rid>/<path>?v=<sha>、
  // Electron は plugumi-ui://… 等を返す想定。
  uiURL(coreKey: string, registrationId: string, path: string, uiSha256: string): string;
}

export const ShellHostContext = createContext<ShellHost>();

export function ShellHostProvider(props: ParentProps<{ value: ShellHost }>): JSX.Element {
  return (
    <ShellHostContext.Provider value={props.value}>
      {props.children}
    </ShellHostContext.Provider>
  );
}

export function useShellHost(): ShellHost {
  const host = useContext(ShellHostContext);
  if (!host) throw new Error("ShellHostProvider の外で Plugin Shell を描画できません");
  return host;
}
