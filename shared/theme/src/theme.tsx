// テーマ切替Panelの本体。Pluginと同じく `mount(host, context)` で
// ShadowRootへ描く。テーマの読み書きはCore Toolではなく端末localの
// prefsなので、同梱Panelにだけ渡される context.shell を使う —
// signalがそのまま届くので、他のtheme Panelや別経路の変更にも追従する。
import { For, Show, createSignal, onCleanup } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import type { ViewContext, ViewHandle } from "@plugumi/view";

type ThemeMode = "system" | "light" | "dark";

// shellから受け取る最小の口。ShellControllerの型は引かず、
// このPanelが触るsliceだけを宣言する。
export interface ThemeShell {
  prefs(): { theme: ThemeMode; aurora: boolean; auroraVivid: number; frameAlpha: number; tabAlpha: number; sansFont: string; monoFont: string };
  updatePrefs(mutate: (prefs: { theme: ThemeMode; aurora: boolean; auroraVivid: number; frameAlpha: number; tabAlpha: number; sansFont: string; monoFont: string }) => void): void;
}

export interface ThemePanelContext extends ViewContext {
  shell: ThemeShell;
}

const MODES: readonly (readonly [ThemeMode, string])[] = [
  ["system", "システム"],
  ["light", "ライト"],
  ["dark", "ダーク"],
];

function ThemePanel(props: { shell: ThemeShell }): JSX.Element {
  const theme = () => props.shell.prefs().theme;
  // 「システム」選択時に今OSがどちらかを添える。OS側の変更にも追従する
  // （prefsが別経路で変わってもtheme()が追う）。
  const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const [osDark, setOsDark] = createSignal(systemQuery.matches);
  const onScheme = (event: MediaQueryListEvent) => setOsDark(event.matches);
  systemQuery.addEventListener("change", onScheme);
  onCleanup(() => systemQuery.removeEventListener("change", onScheme));
  const resolved = () => (theme() === "system" ? (osDark() ? "dark" : "light") : theme());
  return (
    <div class="theme-panel">
      <div class="theme-seg" role="radiogroup" aria-label="テーマ">
        <For each={MODES}>
          {([mode, label]) => (
            <button
              class={{ "theme-item": true, selected: theme() === mode }}
              role="radio"
              aria-checked={theme() === mode ? "true" : "false"}
              onClick={() => props.shell.updatePrefs((prefs) => {
                prefs.theme = mode;
              })}
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <Show when={theme() === "system"}>
        <p class="theme-note">
          今は{resolved() === "dark" ? "ダーク" : "ライト"}
        </p>
      </Show>
      <label class="theme-check">
        <input
          type="checkbox"
          checked={props.shell.prefs().aurora}
          onChange={(event) => props.shell.updatePrefs((prefs) => {
            prefs.aurora = event.currentTarget.checked;
          })}
        />
        <span>オーロラ</span>
      </label>
      <label class="theme-slider">
        <span class="theme-slider-label">tabの濃さ</span>
        <input
          type="range" min={0} max={100}
          value={props.shell.prefs().tabAlpha}
          onInput={(event) => props.shell.updatePrefs((prefs) => {
            prefs.tabAlpha = Number(event.currentTarget.value);
          })}
        />
      </label>
      <label class="theme-slider">
        <span class="theme-slider-label">背景の濃さ</span>
        <input
          type="range" min={0} max={100}
          value={props.shell.prefs().frameAlpha}
          onInput={(event) => props.shell.updatePrefs((prefs) => {
            prefs.frameAlpha = Number(event.currentTarget.value);
          })}
        />
      </label>
      <label class="theme-slider">
        <span class="theme-slider-label">背景の鮮やかさ</span>
        <input
          type="range" min={0} max={200}
          value={props.shell.prefs().auroraVivid}
          onInput={(event) => props.shell.updatePrefs((prefs) => {
            prefs.auroraVivid = Number(event.currentTarget.value);
          })}
        />
      </label>
      <label class="theme-slider">
        <span class="theme-slider-label">sansフォント</span>
        <input
          type="text" class="theme-text"
          value={props.shell.prefs().sansFont}
          onInput={(event) => props.shell.updatePrefs((prefs) => {
            prefs.sansFont = event.currentTarget.value;
          })}
        />
      </label>
      <label class="theme-slider">
        <span class="theme-slider-label">monoフォント</span>
        <input
          type="text" class="theme-text"
          value={props.shell.prefs().monoFont}
          onInput={(event) => props.shell.updatePrefs((prefs) => {
            prefs.monoFont = event.currentTarget.value;
          })}
        />
      </label>
    </div>
  );
}

export function mount(host: ShadowRoot, context: ThemePanelContext): ViewHandle {
  const dispose = render(() => <ThemePanel shell={context.shell} />, host);
  return { destroy: () => dispose() };
}
