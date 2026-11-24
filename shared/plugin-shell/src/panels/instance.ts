// Panel Instanceの寿命（contracts/00005）。Instanceは{pluginId,panelId}と
// 保存上のinstanceId（panel-…）を持ち、registrationIdは都度解決する
// （Plugin再起動で変わるため保存しない。0件ならmissing、複数なら昇順の先頭）。
import { createSignal } from "solid-js";
import type { PanelMount, PanelHandle } from "@plugumi/plugin-view";
import type { PanelEntry, PluginPanelEntry, ShellHost } from "../host.tsx";
import type { ShellController } from "../shell/controller.tsx";
import type { PanelRef } from "../layout/model.ts";
import { acquirePanelStyles } from "./styles.ts";
import type { ActivityState } from "../shell/activity.ts";
import type { PanelActivity } from "@plugumi/plugin-view";

// context.setActivityの入力をShell内部の形へ。effect省略はstatic。
function normalizeActivity(activity: PanelActivity | null): ActivityState | undefined {
  if (!activity) return undefined;
  return {
    busy: activity.busy ?? false,
    progress: activity.progress,
    layers: (activity.layers ?? []).map((layer) => ({
      surface: layer.surface,
      tone: layer.tone,
      effect: layer.effect ?? "static",
    })),
  };
}

export type InstanceState = "mounting" | "mounted" | "missing";
export type MountErrorKind = "load" | "contract" | "mount";

export interface MountError {
  kind: MountErrorKind;
  message: string;
}

interface PanelModule {
  mount: PanelMount;
}

// pluginId+panelIdが同じ宣言を現在のpanels一覧から選ぶ。
// 0件ならundefined（missing）、複数ならRPCが生きている宣言を優先し、
// 同じ条件ならregistrationId昇順の先頭。登録がWS切断で残っている
// （rpcAvailable:false）間も代替があればそちらへ移れるようにする。
export function resolvePanel(
  ref: Pick<PanelRef, "pluginId" | "panelId">, panels: PanelEntry[],
): PanelEntry | undefined {
  const candidates = panels
    .filter((panel) => panel.pluginId === ref.pluginId && panel.panelId === ref.panelId)
    .sort((a, b) => {
      if (a.kind !== "plugin" || b.kind !== "plugin") return 0;
      if (a.rpcAvailable !== b.rpcAvailable) return a.rpcAvailable ? -1 : 1;
      return a.registrationId.localeCompare(b.registrationId);
    });
  return candidates[0];
}

export class PanelInstance {
  readonly id: string;
  readonly pluginId: string;
  readonly panelId: string;
  readonly host: HTMLDivElement;
  registrationId = "";
  uiSha256 = "";

  readonly title: () => string;
  readonly state: () => InstanceState;
  readonly error: () => MountError | undefined;
  readonly activity: () => ActivityState | undefined;
  private setTitle: (title: string) => void;
  private setState: (state: InstanceState) => void;
  private setError: (error: MountError | undefined) => void;
  private setActivity: (activity: ActivityState | undefined) => void;

  private entry = "";
  private destroyPanel: (() => void) | undefined;
  private releaseStyles: (() => void) | undefined;
  // PanelはPlugin・組み込みともShadowRootへ描く。
  private shadow: ShadowRoot | undefined;
  private mountToken = 0;
  // mountは直列にしか走らせない。同時に2本進めると、staleになった側の
  // handle.destroy()がsharedなShadowRootごと消して、新しい側の描画を
  // 巻き込む（destroyは自分が挿したnodeだけでなくrootを全消しする）。
  private pending: PanelEntry | undefined;
  private mounting = false;

  private kind: "plugin" | "builtin";
  private readonly shell: ShellHost;
  private readonly controller: ShellController;
  private readonly coreKey: string;
  // context.inputへ渡す開き時の入力。AreaControllerがInstance作成時に入れる。
  input: unknown;
  // context.openPanelの実体。AreaControllerがInstance作成時に差す —
  // Instance自身は自分がどのleafに居るか知らないので、呼び出し時点の
  // layoutから探す側に任せる。
  openSibling: ((panelId: string, input?: unknown) => void) | undefined;

  constructor(
    shell: ShellHost, coreKey: string, ref: PanelRef, title: string,
    controller: ShellController, kind: PanelEntry["kind"] = "plugin",
  ) {
    this.shell = shell;
    this.controller = controller;
    this.kind = kind;
    this.coreKey = coreKey;
    this.id = ref.instanceId;
    this.pluginId = ref.pluginId;
    this.panelId = ref.panelId;
    this.host = document.createElement("div");
    this.host.dataset.part = "panel-host";
    this.host.dataset.plugumiPlugin = "";
    const [titleSignal, setTitle] = createSignal(title);
    const [state, setState] = createSignal<InstanceState>("mounting");
    const [error, setError] = createSignal<MountError>();
    const [activity, setActivity] = createSignal<ActivityState>();
    this.title = titleSignal;
    this.state = state;
    this.error = error;
    this.activity = activity;
    this.setTitle = setTitle;
    this.setState = setState;
    this.setError = setError;
    this.setActivity = setActivity;
  }

  ref(): PanelRef {
    return { instanceId: this.id, pluginId: this.pluginId, panelId: this.panelId };
  }

  // mountを（再）実行する。失敗してもInstanceは残り、「再試行」で同じ
  // Instanceのまま呼び直せる。tokenで古い非同期結果を捨てる。
  // 進行中の非同期を無効化し、mount済みのPanelとstyleを外す。
  private teardown(): void {
    this.mountToken++;
    // キューに積まれたmountも取り消す（missing/dispose時に古い描画を
    // 遅れて再実行させない）。doMountからの呼び出しではpendingは
    // すでに取り出し済みで空なので無害。
    this.pending = undefined;
    this.destroyPanel?.();
    this.destroyPanel = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    if (this.shadow) {
      // shadowの中身とadoptしたstyleはPanelのもの。Instanceをまたいで
      // 残さない（Panel自身のdestroyが掃除しない分もここで落とす）。
      this.shadow.adoptedStyleSheets = [];
      this.shadow.replaceChildren();
    }
  }

  // mountの入口はここだけ。進行中なら最新のentryに積み替えて終わり、
  // 走っていなければ pending が尽きるまで順にdoMountする。
  async mount(panel: PanelEntry): Promise<void> {
    this.pending = panel;
    if (this.mounting) return;
    this.mounting = true;
    try {
      while (this.pending) {
        const next = this.pending;
        this.pending = undefined;
        await this.doMount(next);
      }
    } finally {
      this.mounting = false;
    }
  }

  private async doMount(panel: PanelEntry): Promise<void> {
    this.setTitle(panel.title);
    this.teardown();
    const token = this.mountToken;
    this.host.replaceChildren();
    this.setState("mounting");
    this.setError(undefined);
    this.setActivity(undefined);

    const fail = (kind: MountErrorKind, cause: unknown) => {
      if (token !== this.mountToken) return;
      this.setError({ kind, message: String(cause) });
    };

    const root = this.shadow ?? this.host.attachShadow({ mode: "open" });
    this.shadow = root;

    if (panel.kind === "builtin") {
      // 組み込みはCoreを経由しない — fetch・import・callToolなしで、
      // bundle同梱のmountとcssを使う。DOMの置き場はPluginと同じ
      // ShadowRootで、呼ぶcontractも同じ。
      this.kind = "builtin";
      this.host.dataset.plugumiPlugin = "shell";
      if (panel.css) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(panel.css);
        root.adoptedStyleSheets = [sheet];
      }
      let handle: PanelHandle;
      try {
        handle = await panel.mount(root, {
          root,
          // 組み込みにCore Toolは無い。Shell状態にはcontext.shellで届く。
          callTool: () => Promise.reject(new Error("組み込みPanelはToolを呼べません")),
          setActivity: (activity) => this.setActivity(normalizeActivity(activity)),
          input: this.input,
          openPanel: (panelId, input) => this.openSibling?.(panelId, input),
          shell: this.controller,
        });
      } catch (cause) {
        fail("mount", cause);
        return;
      }
      if (token !== this.mountToken) {
        handle.destroy?.();
        return;
      }
      this.destroyPanel = () => handle.destroy?.();
      this.setState("mounted");
      return;
    }
    this.kind = "plugin";
    this.registrationId = panel.registrationId;
    this.uiSha256 = panel.uiSha256;
    this.entry = panel.entry;
    this.host.dataset.plugumiPlugin = panel.registrationId;

    let release: () => void;
    let sheet: CSSStyleSheet;
    let module: PanelModule;
    try {
      const styles = await acquirePanelStyles(this.shell, this.coreKey, panel);
      release = styles.release;
      sheet = styles.sheet;
    } catch (cause) {
      fail("load", cause);
      return;
    }
    if (token !== this.mountToken) {
      release();
      return;
    }
    root.adoptedStyleSheets = [sheet];
    try {
      const url = this.shell.uiURL(
        this.coreKey, this.registrationId, this.entry, this.uiSha256,
      );
      module = (await import(/* @vite-ignore */ url)) as PanelModule;
    } catch (cause) {
      release();
      fail("load", cause);
      return;
    }
    if (typeof module.mount !== "function") {
      release();
      fail("contract", "module does not export mount(host, context)");
      return;
    }
    if (token !== this.mountToken) {
      release();
      return;
    }
    let handle: PanelHandle;
    try {
      handle = await module.mount(root, {
        root,
        callTool: (toolPath, input) =>
          this.shell.callTool(this.coreKey, {
            registrationId: this.registrationId, toolPath, input,
          }),
        // Pluginは意味だけ渡す。呼ぶたびに全体を置き換える。
        setActivity: (activity) => this.setActivity(normalizeActivity(activity)),
        input: this.input,
        openPanel: (panelId, input) => this.openSibling?.(panelId, input),
      });
    } catch (cause) {
      release();
      fail("mount", cause);
      return;
    }
    if (token !== this.mountToken) {
      handle.destroy?.();
      release();
      return;
    }
    this.releaseStyles = release;
    this.destroyPanel = () => handle.destroy?.();
    this.setState("mounted");
  }

  retry(panels: PanelEntry[]) {
    const panel = resolvePanel(this, panels);
    if (panel) void this.mount(panel);
    else this.setState("missing");
  }

  // 今mount中/済みのentryと同じか（重複mountを省く判定）。
  private current(panel: PanelEntry): boolean {
    if (this.kind !== panel.kind) return false;
    if (panel.kind === "builtin") return this.panelId === panel.panelId;
    return this.registrationId === panel.registrationId
      && this.panelId === panel.panelId
      && this.uiSha256 === panel.uiSha256;
  }

  // panels一覧の更新を追従する。自分のregistrationIdが生きていれば
  // uiSha256の変化だけ見る。無ければpluginId+panelIdで解決し直す。
  update(panels: PanelEntry[]): void {
    // builtinは一覧から消えずUIの更新も無いので、一度mountしたら追わない。
    if (this.kind === "builtin") return;
    const same = panels.find((panel): panel is PluginPanelEntry =>
      panel.kind === "plugin" &&
      panel.registrationId === this.registrationId && panel.panelId === this.panelId,
    );
    // rpcAvailable:falseの登録は一覧に残るので、liveの代替があるなら
    // 解決し直して移る（callToolが通る方を優先する）。
    if (same?.rpcAvailable) {
      if (this.state() === "missing" || same.uiSha256 !== this.uiSha256) {
        void this.mount(same);
      }
      return;
    }
    const replacement = resolvePanel(this, panels);
    if (replacement) {
      // 同じentryをすでにmount中/済みなら積まない（mount前にupdateが
      // 走るとregistrationId等がまだ空で同一判定できず重複する）。
      // error時は再mountしてよい — 一覧の変化を機会に回復する。
      if (!this.current(replacement) || this.error()) void this.mount(replacement);
      return;
    }
    this.teardown();
    this.host.replaceChildren();
    this.setState("missing");
  }

  dispose(): void {
    this.teardown();
    this.host.remove();
  }
}
