// Plugin Shell の画面が外（web pluginのサーバー、Electron main等）と話す口。
// 画面側はこのinterfaceだけを使い、fetch先やURLの組み立ては宿主が実装する。
// WorkspaceはShell所有のJSON: getはunknownのまま受け取り、
// Shellがdecodeする。putはShellのstateをそのまま渡す。
import { createContext, useContext, type ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { WorkspaceState } from "./layout/model.ts";

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

  // 未保存・壊れた形はnullかobject以外で返ることがある。decodeはShell側。
  getWorkspace(key: string, project: string, areaPath: string[]): Promise<unknown>;
  putWorkspace(key: string, project: string, areaPath: string[], workspace: WorkspaceState): Promise<void>;

  // Panel の entry/styles を取るURL。web は /ui/<key>/<rid>/<path>?v=<sha>、
  // Electron は plugumi-ui://… を返す。
  uiURL(coreKey: string, registrationId: string, path: string, uiSha256: string): string;

  // 別windowで同じShellを開く（FloatingのArea用）。webは新タブ、
  // Electronは新しいBrowserWindow。pathはrouteのpath+query。
  openWindow(path: string): void;
}

export const ShellHostContext = createContext<ShellHost>();

export function ShellHostProvider(props: ParentProps<{ value: ShellHost }>): JSX.Element {
  return (
    <ShellHostContext value={props.value}>
      {props.children}
    </ShellHostContext>
  );
}

export function useShellHost(): ShellHost {
  // default-lessなのでProvider不在ならuseContextが投げる。
  return useContext(ShellHostContext);
}
