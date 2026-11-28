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
type BackgroundKind = "none" | "aurora" | "image";

export interface ThemeShell {
  prefs(): { theme: ThemeMode; background: BackgroundKind; backgroundImage: string; auroraVivid: number; membraneBlur: number; frameAlpha: number; tabAlpha: number; sansFont: string; monoFont: string };
  updatePrefs(mutate: (prefs: { theme: ThemeMode; background: BackgroundKind; backgroundImage: string; auroraVivid: number; membraneBlur: number; frameAlpha: number; tabAlpha: number; sansFont: string; monoFont: string }) => void): void;
}

export interface ThemePanelContext extends ViewContext {
  shell: ThemeShell;
}

const MODES: readonly (readonly [ThemeMode, string])[] = [
  ["system", "システム"],
  ["light", "ライト"],
  ["dark", "ダーク"],
];

const BACKGROUNDS: readonly (readonly [BackgroundKind, string])[] = [
  ["none", "なし"],
  ["aurora", "オーロラ"],
  ["image", "画像"],
];

// 画像をdownscaleしてJPEGのdata URLにする。localStorageに載る大きさ
// （目安1MB強）まで順に落とす。それでも無理なら null。
async function compressImage(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!image) return null;
    for (const [max, quality] of [[1600, 0.82], [1200, 0.7], [900, 0.6]] as const) {
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length < 1_600_000) return dataUrl;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

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
      <div class="theme-seg" role="radiogroup" aria-label="背景">
        <For each={BACKGROUNDS}>
          {([kind, label]) => (
            <button
              class={{ "theme-item": true, selected: props.shell.prefs().background === kind }}
              role="radio"
              aria-checked={props.shell.prefs().background === kind ? "true" : "false"}
              onClick={() => props.shell.updatePrefs((prefs) => {
                prefs.background = kind;
              })}
            >
              {label}
            </button>
          )}
        </For>
      </div>
      <Show when={props.shell.prefs().background === "image"}>
        <div class="theme-image-row">
          <label class="theme-image-pick">
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                void compressImage(file).then((dataUrl) => {
                  if (dataUrl) {
                    props.shell.updatePrefs((prefs) => {
                      prefs.backgroundImage = dataUrl;
                    });
                  }
                });
                // 同じファイルを続けて選べるよう値を戻す。
                event.currentTarget.value = "";
              }}
            />
            <span class="theme-image-button">画像を選ぶ</span>
          </label>
          <Show when={props.shell.prefs().backgroundImage}>
            <button
              class="theme-image-clear"
              onClick={() => props.shell.updatePrefs((prefs) => {
                prefs.backgroundImage = "";
              })}
            >
              消す
            </button>
          </Show>
        </div>
      </Show>
      <label class="theme-slider">
        <span class="theme-slider-label">膜のぼかし</span>
        <input
          type="range" min={0} max={100}
          value={props.shell.prefs().membraneBlur}
          onInput={(event) => props.shell.updatePrefs((prefs) => {
            prefs.membraneBlur = Number(event.currentTarget.value);
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
      <Show when={props.shell.prefs().background === "aurora"}>
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
      </Show>
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
