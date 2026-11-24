// Shell組み込みPanel。CoreのPluginを経由せずShellが直接mountするので、
// Core未接続でも常に一覧に出る。最初の1つはテーマ切替Panel
// （pluginId "shell" / panelId "theme"）。
import { For, Show, createSignal, onCleanup } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import type { BuiltinPanelEntry } from "../host.tsx";
import type { ShellController } from "../shell/controller.tsx";
import type { ThemeMode } from "../prefs.ts";
import styles from "./builtin.module.css";

const MODES: readonly (readonly [ThemeMode, string])[] = [
  ["system", "システム"],
  ["light", "ライト"],
  ["dark", "ダーク"],
];

function ThemePanel(props: { shell: ShellController }): JSX.Element {
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
    <div class={styles["builtin-theme"]}>
      <div class={styles["builtin-theme-seg"]} role="radiogroup" aria-label="テーマ">
        <For each={MODES}>
          {([mode, label]) => (
            <button
              class={{ [styles["builtin-theme-item"]]: true, [styles["selected"]]: theme() === mode }}
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
        <p class={styles["builtin-theme-note"]}>
          今は{resolved() === "dark" ? "ダーク" : "ライト"}
        </p>
      </Show>
    </div>
  );
}

export const builtinPanels: BuiltinPanelEntry[] = [
  {
    kind: "builtin",
    pluginId: "shell",
    panelId: "theme",
    title: "テーマ",
    mount: (host, shell) => render(() => <ThemePanel shell={shell} />, host),
  },
];
