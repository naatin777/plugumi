// Panel Instanceの寿命を管理する。Instanceは{pluginId,panelId}と保存上の
// instanceId（panel-…）を持ち、registrationIdは都度解決する（Plugin再起動で
// 変わるため保存しない。0件ならmissing、複数ならregistrationId昇順の先頭）。
// 仕様は docs/contracts/00005-panel-module.md を参照。
import { createSignal } from "solid-js";
import type { PanelEntry, PanelRef, ShellHost } from "../host";
import type { PanelActivity, PanelHandle, PanelMount } from "@plugumi/plugin-view";
import { acquirePanelStyles } from "./styles";

export type InstanceState = "mounting" | "mounted" | "missing";
export type MountErrorKind = "load" | "contract" | "mount";

export interface MountError {
  kind: MountErrorKind;
  message: string;
}

interface PanelModule {
  mount: PanelMount;
}

// resolvePanel はPanelRefが指す宣言を現在のpanels一覧から選ぶ。
// 0件ならundefined（missing）、複数ならregistrationId昇順の先頭。
export function resolvePanel(ref: Pick<PanelRef, "pluginId" | "panelId">, panels: PanelEntry[]): PanelEntry | undefined {
  const candidates = panels
    .filter((panel) => panel.pluginId === ref.pluginId && panel.panelId === ref.panelId)
    .sort((first, second) => first.registrationId.localeCompare(second.registrationId));
  return candidates[0];
}

export class PanelInstance {
  readonly id: string;
  readonly pluginId: string;
  readonly panelId: string;
  title: string;
  readonly host: HTMLDivElement;
  registrationId = "";
  uiSha256 = "";

  readonly state: () => InstanceState;
  readonly error: () => MountError | undefined;
  // PluginがsetActivityで通知した活動状態。Shellが描画する。
  readonly activity: () => PanelActivity | null;
  private setActivity: (activity: PanelActivity | null) => void;
  private setState: (state: InstanceState) => void;
  private setError: (error: MountError | undefined) => void;

  private entry = "";
  private styles: string[] = [];
  private readonly shellHost: ShellHost;
  private coreKey: string;
  private destroyPanel: (() => void) | undefined;
  private releaseStyles: (() => void) | undefined;
  private mountToken = 0;

  constructor(shellHost: ShellHost, coreKey: string, ref: PanelRef, title: string) {
    this.shellHost = shellHost;
    this.coreKey = coreKey;
    this.id = ref.instanceId;
    this.pluginId = ref.pluginId;
    this.panelId = ref.panelId;
    this.title = title;
    this.host = document.createElement("div");
    this.host.className = "instance-host";
    this.host.dataset.plugumiPlugin = "";
    const [state, setState] = createSignal<InstanceState>("mounting");
    const [error, setError] = createSignal<MountError>();
    const [activity, setActivity] = createSignal<PanelActivity | null>(null);
    this.state = state;
    this.error = error;
    this.activity = activity;
    this.setActivity = setActivity;
    this.setState = setState;
    this.setError = setError;
  }

  ref(): PanelRef {
    return { instanceId: this.id, pluginId: this.pluginId, panelId: this.panelId };
  }

  // mountを（再）実行する。失敗してもInstanceは残り、「再試行」で同じ
  // Instanceのまま呼び直せる。tokenで古い非同期結果を捨てる。
  async mount(panel: PanelEntry): Promise<void> {
    this.registrationId = panel.registrationId;
    this.uiSha256 = panel.uiSha256;
    this.entry = panel.entry;
    this.styles = panel.styles;
    this.title = panel.title;
    this.host.dataset.plugumiPlugin = panel.registrationId;
    const token = ++this.mountToken;
    this.destroyPanel?.();
    this.destroyPanel = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.host.replaceChildren();
    this.setState("mounting");
    this.setError(undefined);

    const fail = (kind: MountErrorKind, cause: unknown) => {
      if (token !== this.mountToken) return;
      this.setError({ kind, message: String(cause) });
    };

    let release: () => void;
    let module: PanelModule;
    try {
      release = await acquirePanelStyles(this.shellHost, this.coreKey, this.currentPanel());
    } catch (cause) {
      fail("load", cause);
      return;
    }
    if (token !== this.mountToken) {
      release();
      return;
    }
    try {
      const url = this.shellHost.uiURL(
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
      handle = await module.mount(this.host, {
        callTool: (toolPath, input) =>
          this.shellHost.callTool(this.coreKey, {
            registrationId: this.registrationId, toolPath, input,
          }),
        setActivity: (activity) => this.setActivity(activity),
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

  private currentPanel(): PanelEntry {
    return {
      registrationId: this.registrationId, pluginId: this.pluginId,
      panelId: this.panelId, title: this.title,
      entry: this.entry, styles: this.styles, uiSha256: this.uiSha256,
    };
  }

  // panels一覧の更新を追従する。自分のregistrationIdが生きていれば
  // uiSha256の変化だけ見る。無ければpluginId+panelIdで解決し直す。
  update(panels: PanelEntry[]): void {
    const same = panels.find(
      (panel) => panel.registrationId === this.registrationId && panel.panelId === this.panelId,
    );
    if (same) {
      if (this.state() === "missing" || same.uiSha256 !== this.uiSha256) {
        void this.mount(same);
      }
      return;
    }
    const replacement = resolvePanel(this, panels);
    if (replacement) {
      void this.mount(replacement);
      return;
    }
    this.mountToken++;
    this.destroyPanel?.();
    this.destroyPanel = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.host.replaceChildren();
    this.setState("missing");
  }

  dispose(): void {
    this.mountToken++;
    this.destroyPanel?.();
    this.destroyPanel = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
    this.host.remove();
  }
}
