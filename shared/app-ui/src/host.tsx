// plugumiの画面が外（web pluginのサーバー、Electron main等）と話す口。
// 画面側はこのinterfaceだけを使い、fetch先やURLの組み立ては宿主が実装する。
// WorkspaceはShell所有のJSON: getはunknownのまま受け取り、
// Shellがdecodeする。putはShellのstateをそのまま渡す。
import { createContext, useContext, type ParentProps } from "solid-js";
import type { JSX } from "@solidjs/web";
import type { ViewContext, ViewHandle } from "@plugumi/view";
import type { WorkspaceState } from "./layout/model.ts";
import type { AppController } from "./app/controller.tsx";

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

// ---- /api/cores 系の型。spec駆動 — apps/webのhumaが生成するOpenAPI
// specからopenapi-typescriptで作られる（pnpm run gen:api）。
// 手書きでGoと同期する時代のものはgen/api-types.tsが正義。
import type { components } from "./gen/api-types.ts";

type ApiSchema = components["schemas"];

// enum相当はGo側が素のstringなので、TS側でunionへ絞る。
export type CoreSource = "command" | "saved";
export type CoreStatus = "connecting" | "connected" | "rejected" | "unreachable";

export type CoreEntry = Omit<ApiSchema["Core"], "source" | "status"> & {
  source: CoreSource;
  status: CoreStatus;
};

// Shell組み込みPanel。providerId "app" のlocal PluginとしてShellの
// bundleに同梱され、Pluginと同じくShadowRootへmountする。
// contextはPluginと同じPanelContextに、Shell内部へ届くshellを足した
// もの — 同梱コードなので信頼境界はなく、端末localのprefsのような
// Shell状態に届けるためにある。組み込みはview channelを持たない
// （Coreを経由しない）のでconnectionは形だけのものを入れる。
export interface BuiltinPanelContext extends PanelContext {
  host: AppController;
  // 任意のprovider/panelを開く。view contextのopenPanelは同じpluginの
  // panelだけだが、組み込みpanel（Files等）は別providerのpanelを
  // 開きたい（file clickでeditorを開く等）。自分が居るAreaへ開く。
  openPanelAcross?(providerId: string, panelId: string, input?: unknown): void;
}

export type BuiltinPanelMount =
  (host: ShadowRoot, context: BuiltinPanelContext) => PanelHandle | Promise<PanelHandle>;

// CoreのJSONはgeneratedのPanelEntryが正義。kindはfrontendが付ける
// 識別子（builtinとのunionを作るため）。rpcAvailable=falseの宣言はmount
// はできるがview channelが繋がらないので、同じpanelIdにliveの宣言が
// あればそちらを優先する。
export type PluginPanelEntry = ApiSchema["PanelEntry"] & {
  kind: "plugin";
};

export interface BuiltinPanelEntry {
  kind: "builtin";
  providerId: "app";
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
// wire上は末端のareasがnullで来る（Goのnil slice）が、host境界で[]へ
// 正規化する — Hostの契約としては常に配列。
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

export type InvokeBody = ApiSchema["InvokeInputBody"];

// view instanceの登録応答（POST /api/cores/{key}/views）。
// shellはticketとCore URLをpanelのcontext.connectionへ入れる。
export type ViewTicket = ApiSchema["ViewTicket"];

// Registryの1登録。Shell同梱Viewがcapability宣言から呼び出し先を
// 選ぶために使う（file explorerがfilesystem/listを探す等）。
export type RegistrationEntry = ApiSchema["RegistryRegistration"];

export interface Host {
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

export const HostContext = createContext<Host>();

export function HostProvider(props: ParentProps<{ value: Host }>): JSX.Element {
  return (
    <HostContext value={props.value}>
      {props.children}
    </HostContext>
  );
}

export function useHost(): Host {
  // default-lessなのでProvider不在ならuseContextが投げる。
  return useContext(HostContext);
}
