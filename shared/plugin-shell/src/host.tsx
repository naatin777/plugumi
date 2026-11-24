// Plugin Shell の画面が外（web pluginのサーバー、Electron main等）と話す口。
// 画面側はこのinterfaceだけを使い、fetch先やURLの組み立ては宿主が実装する。
// WorkspaceはShell所有のJSON: getはunknownのまま受け取り、
// Shellがdecodeする。putはShellのstateをそのまま渡す。
import { createContext, useContext, type ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { PanelContext, PanelHandle } from "@plugumi/plugin-view";
import type { WorkspaceState } from "./layout/model.ts";
import type { ShellController } from "./shell/controller.tsx";

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

// Shell組み込みPanel。pluginId "shell" のlocal PluginとしてShellの
// bundleに同梱され、Pluginと同じくShadowRootへmountする
// （contracts/00005のPanelMountと同じ形）。
// contextはPluginと同じPanelContextに、Shell内部へ届くshellを足した
// もの — 同梱コードなので信頼境界はなく、Core Toolではなく端末localの
// prefsのようなShell状態に届けるためにある。
export interface BuiltinPanelContext extends PanelContext {
  shell: ShellController;
}

export type BuiltinPanelMount =
  (host: ShadowRoot, context: BuiltinPanelContext) => PanelHandle | Promise<PanelHandle>;

export interface PluginPanelEntry {
  kind: "plugin";
  registrationId: string;
  pluginId: string;
  panelId: string;
  title: string;
  entry: string;
  styles: string[];
  uiSha256: string;
  // 提供元の登録のRPC接続が生きているか。falseの宣言はmountはできるが
  // callToolが通らないので、同じpanelIdにliveの宣言があればそちらを優先する。
  rpcAvailable: boolean;
}

export interface BuiltinPanelEntry {
  kind: "builtin";
  pluginId: "shell";
  panelId: string;
  title: string;
  mount: BuiltinPanelMount;
  // ShadowRootへadoptするCSSテキスト。Pluginのstyles（Core経由の
  // fetch）と違い、bundleに同梱されるので文字列を直接持つ。
  css?: string;
}

export type PanelEntry = PluginPanelEntry | BuiltinPanelEntry;

// keyはURL path segmentとして使う識別子（serverが発行する）、
// titleは自由な表示名。nameを兼ねない — 日本語・大文字・記号をそのまま出せる。
export interface AreaTree {
  key: string;
  title: string;
  areas: AreaTree[];
}

export interface ProjectTree {
  key: string;
  title: string;
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

  listPanels(key: string): Promise<PluginPanelEntry[]>;
  callTool(key: string, body: CallToolBody): Promise<unknown>;

  listProjects(key: string): Promise<ProjectTree[]>;
  // 作成はtitleを渡し、発行されたkeyが返る。
  createProject(key: string, title: string): Promise<string>;
  createArea(key: string, project: string, parent: string[], title: string): Promise<string>;
  deleteArea(key: string, project: string, areaPath: string[]): Promise<void>;

  // 未保存・壊れた形はnullかobject以外で返ることがある。decodeはShell側。
  getWorkspace(key: string, project: string, areaPath: string[]): Promise<unknown>;
  putWorkspace(key: string, project: string, areaPath: string[], workspace: WorkspaceState): Promise<void>;

  // Panel の entry/styles を取るURL。web は /ui/<key>/<rid>/<path>?v=<sha>
  // を返す（ElectronはそのURLをwindowで開くだけのviewer）。
  uiURL(coreKey: string, registrationId: string, path: string, uiSha256: string): string;

  // Areaを別windowに出す（detach）。Electronのpreloadが注入するbridge
  // があれば有効。ブラウザではnull（項目自体を出さない）。pathはrouteのpath+query。
  windows: { open(path: string): void } | null;
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
