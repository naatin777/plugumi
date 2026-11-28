// Plugin Shell の画面が外（web pluginのサーバー、Electron main等）と話す口。
// 画面側はこのinterfaceだけを使い、fetch先やURLの組み立ては宿主が実装する。
// WorkspaceはShell所有のJSON: getはunknownのまま受け取り、
// Shellがdecodeする。putはShellのstateをそのまま渡す。
import { createContext, useContext, type ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ViewContext, ViewHandle } from "@plugumi/view";
import type { WorkspaceState } from "./layout/model.ts";
import type { ShellController } from "./shell/controller.tsx";

// Panelのmountに渡すcontext。view channelの接続情報に加えて、
// workbenchはactivity通知とopenPanelを必ず提供する。
// Pluginのview entryはdefineViewで包まれ、接続はSDKが担う（designs/00011）。
export interface PanelContext extends ViewContext {
  root: ShadowRoot;
  setActivity: NonNullable<ViewContext["setActivity"]>;
  openPanel: NonNullable<ViewContext["openPanel"]>;
}

export type PanelHandle = ViewHandle;
export type PanelMount = (host: ShadowRoot, context: PanelContext) => PanelHandle | Promise<PanelHandle>;

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

// Shell組み込みPanel。providerId "shell" のlocal PluginとしてShellの
// bundleに同梱され、Pluginと同じくShadowRootへmountする。
// contextはPluginと同じPanelContextに、Shell内部へ届くshellを足した
// もの — 同梱コードなので信頼境界はなく、端末localのprefsのような
// Shell状態に届けるためにある。組み込みはview channelを持たない
// （Coreを経由しない）のでconnectionは形だけのものを入れる。
export interface BuiltinPanelContext extends PanelContext {
  shell: ShellController;
  // 任意のprovider/panelを開く。view contextのopenPanelは同じpluginの
  // panelだけだが、組み込みpanel（Files等）は別providerのpanelを
  // 開きたい（file clickでeditorを開く等）。自分が居るAreaへ開く。
  openPanelAcross?(providerId: string, panelId: string, input?: unknown): void;
}

export type BuiltinPanelMount =
  (host: ShadowRoot, context: BuiltinPanelContext) => PanelHandle | Promise<PanelHandle>;

export interface PluginPanelEntry {
  kind: "plugin";
  registrationId: string;
  providerId: string;
  panelId: string;
  title: string;
  entry: string;
  // CoreのJSONでは未宣言だとnullで来るのでoptional扱いにする。
  styles?: string[] | null;
  uiSha256: string;
  // 提供元の登録のRPC接続が生きているか。falseの宣言はmountはできるが
  // view channelが繋がらないので、同じpanelIdにliveの宣言があればそちらを優先する。
  rpcAvailable: boolean;
}

export interface BuiltinPanelEntry {
  kind: "builtin";
  providerId: "shell";
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

export interface InvokeBody {
  operation: string;
  input: unknown;
}

// view instanceの登録応答（POST /api/cores/{key}/views）。
// shellはticketとCore URLをpanelのcontext.connectionへ入れる。
export interface ViewTicket {
  id: string;
  registrationId: string;
  panelId: string;
  status: string;
  ticket: string;
}

// Registryの1登録。Shell同梱Viewがcapability宣言から呼び出し先を
// 選ぶために使う（file explorerがfilesystem/listを探す等）。
export interface RegistrationEntry {
  registrationId: string;
  providerId: string;
  environment?: string;
  ready: boolean;
  rpcAvailable: boolean;
  operations: { path: string; description?: string }[];
}

export interface ShellHost {
  listCores(): Promise<CoreEntry[]>;
  getCore(key: string): Promise<CoreEntry>;
  addCore(url: string): Promise<void>;
  removeCore(url: string): Promise<void>;

  listPanels(key: string): Promise<PluginPanelEntry[]>;
  listRegistrations(key: string): Promise<RegistrationEntry[]>;
  // shell自身がcallerとしてoperationを呼ぶ。builtin panelが
  // environment operationを使う経路。terminal応答だけを扱う。
  invoke(key: string, body: InvokeBody): Promise<unknown>;
  // hostとしてview instanceを登録・closeする（designs/00011）。
  // panelのmount時にcreateViewし、ticketをcontextへ入れる。
  createView(key: string, body: { registrationId: string; panelId: string }): Promise<ViewTicket>;
  closeView(key: string, viewId: string): Promise<void>;

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
