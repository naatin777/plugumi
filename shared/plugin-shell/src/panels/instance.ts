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
// 0件ならundefined（missing）、複数ならregistrationId昇順の先頭。
export function resolvePanel(
  ref: Pick<PanelRef, "pluginId" | "panelId">, panels: PanelEntry[],
): PanelEntry | undefined {
  const candidates = panels
    .filter((panel) => panel.pluginId === ref.pluginId && panel.panelId === ref.panelId)
    // registrationIdで昇順にするのはPlugin Panelだけ（builtinは持たない）。
    .sort((a, b) => a.kind === "plugin" && b.kind === "plugin"
      ? a.registrationId.localeCompare(b.registrationId)
      : 0);
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
  private mountToken = 0;

  private kind: "plugin" | "builtin" = "plugin";
  private readonly shell: ShellHost;
  private readonly controller: ShellController;
  private readonly coreKey: string;

  constructor(
    shell: ShellHost, coreKey: string, ref: PanelRef, title: string,
    controller: ShellController,
  ) {
    this.shell = shell;
    this.controller = controller;
    this.coreKey = coreKey;
    this.id = ref.instanceId;
    this.pluginId = ref.pluginId;
    this.panelId = ref.panelId;
    this.host = document.createElement("div");
    this.host.className = "instance-host";
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
    this.destroyPanel?.();
    this.destroyPanel = undefined;
    this.releaseStyles?.();
    this.releaseStyles = undefined;
  }

  async mount(panel: PanelEntry): Promise<void> {
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

    if (panel.kind === "builtin") {
      // 組み込みはCoreを経由しない — styles取得・import・callToolなしで
      // Shellが直接mountする。
      this.kind = "builtin";
      this.host.dataset.plugumiPlugin = "shell";
      try {
        this.destroyPanel = panel.mount(this.host, this.controller);
        this.setState("mounted");
      } catch (cause) {
        fail("mount", cause);
      }
      return;
    }
    this.kind = "plugin";
    this.registrationId = panel.registrationId;
    this.uiSha256 = panel.uiSha256;
    this.entry = panel.entry;
    this.host.dataset.plugumiPlugin = panel.registrationId;

    let release: () => void;
    let module: PanelModule;
    try {
      release = await acquirePanelStyles(this.shell, this.coreKey, panel);
    } catch (cause) {
      fail("load", cause);
      return;
    }
    if (token !== this.mountToken) {
      release();
      return;
    }
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
      handle = await module.mount(this.host, {
        callTool: (toolPath, input) =>
          this.shell.callTool(this.coreKey, {
            registrationId: this.registrationId, toolPath, input,
          }),
        // Pluginは意味だけ渡す。呼ぶたびに全体を置き換える。
        setActivity: (activity) => this.setActivity(normalizeActivity(activity)),
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

  // panels一覧の更新を追従する。自分のregistrationIdが生きていれば
  // uiSha256の変化だけ見る。無ければpluginId+panelIdで解決し直す。
  update(panels: PanelEntry[]): void {
    // builtinは一覧から消えずUIの更新も無いので、一度mountしたら追わない。
    if (this.kind === "builtin") return;
    const same = panels.find((panel): panel is PluginPanelEntry =>
      panel.kind === "plugin" &&
      panel.registrationId === this.registrationId && panel.panelId === this.panelId,
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
    this.teardown();
    this.host.replaceChildren();
    this.setState("missing");
  }

  dispose(): void {
    this.teardown();
    this.host.remove();
  }
}
