// 最上段のOS帯（.shell-os）に置くShell固有のUI。Pluginからはカスタマイズ不可。
// 左: サイドバー開閉 + Core switcher、右: 検索・メニュー・設定の置き場所（未実装）。
import { useNavigate } from "@solidjs/router";
import { ChevronDown, Fullscreen, Menu, Monitor, Moon, PanelBottom, PanelLeft, PanelRight, Pin, Search, Settings, Sidebar, Sun } from "lucide-solid";
import { createEffect, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { useShellHost, type CoreEntry, type CoreStatus, type PanelEntry } from "./host";
import { loadTheme, type ThemeMode } from "./storage";
import { applyTheme } from "./theme";

const dotClass = (status: CoreStatus | undefined): string => {
  switch (status) {
    case "connected": return "ok";
    case "connecting": return "warn";
    case "rejected": return "err";
    default: return "off";
  }
};

const iconSize = { size: 14, strokeWidth: 2 };
const mod = navigator.platform.includes("Mac") ? "⌘⌥" : "Ctrl+Alt+";

export function TopBar(props: {
  coreKey: string;
  core: () => CoreEntry | undefined;
  sideOpen: boolean;
  onToggleSide: () => void;
  dockOpen: Record<"left" | "bottom" | "right", boolean>;
  onToggleDock: (kind: "left" | "bottom" | "right") => void;
  shelfOpen: boolean;
  onToggleShelf: () => void;
  frameHidden: boolean;
  onToggleFrame: () => void;
  panels: PanelEntry[];
  onAddPanel: (panel: PanelEntry) => void;
}) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  return (
    <>
      {/* topbarは帯自体が領域色: 左右はframe面（紫残る）、中央はwork面
         （紫解除）。sidebarの上とwebの上で帯の色が違う構造。 */}
      <div class="os-seg">
        {/* area list（sidebar）の開閉はtopbarの一番左。 */}
        <button
          class="dock-toggle" classList={{ active: props.sideOpen }}
          title={`サイドバー (${mod}1)`} onClick={props.onToggleSide}
        >
          <Sidebar {...iconSize} />
        </button>
        <CoreSwitch coreKey={props.coreKey} core={props.core} />
      </div>
      <div class="os-seg seg-work">
        {/* Panel追加はtab stripではなくここに集約する。追加先はworkspaceの
           選択中leafで、他の領域へはDnDで移す。 */}
        <div class="top-add">
          <button class="shell-add" title="Panelを追加" onClick={() => setPickerOpen(!pickerOpen())}>+</button>
          <Show when={pickerOpen()}>
            <div class="dock-picker top-picker">
              <For each={props.panels}>
                {(panel) => (
                  <button
                    onClick={() => {
                      props.onAddPanel(panel);
                      setPickerOpen(false);
                    }}
                  >
                    {panel.title} <span class="meta">{panel.pluginId}/{panel.panelId}</span>
                  </button>
                )}
              </For>
              <Show when={props.panels.length === 0}>
                <p class="meta">Panelはありません</p>
              </Show>
            </div>
          </Show>
        </div>
        <div class="dock-toggles">
          <button
            class="dock-toggle" classList={{ active: props.dockOpen.left }}
            title={`Left dock (${mod}2)`} onClick={() => props.onToggleDock("left")}
          >
            <PanelLeft {...iconSize} />
          </button>
          <button
            class="dock-toggle" classList={{ active: props.dockOpen.bottom }}
            title={`Bottom dock (${mod}3)`} onClick={() => props.onToggleDock("bottom")}
          >
            <PanelBottom {...iconSize} />
          </button>
          <button
            class="dock-toggle" classList={{ active: props.dockOpen.right }}
            title={`Right dock (${mod}4)`} onClick={() => props.onToggleDock("right")}
          >
            <PanelRight {...iconSize} />
          </button>
        </div>
      </div>
      <div class="os-seg">
        <button class="shell-tool" disabled title="検索（準備中）"><Search {...iconSize} /></button>
        <button class="shell-tool" disabled title="メニュー（準備中）"><Menu {...iconSize} /></button>
        <button class="shell-tool" disabled title="設定（準備中）"><Settings {...iconSize} /></button>
        <ThemeSwitch />
        <div class="dock-toggles">
          <button
            class="dock-toggle" classList={{ active: props.shelfOpen }}
            title={`Shelf (${mod}5)`} onClick={props.onToggleShelf}
          >
            <Pin {...iconSize} />
          </button>
          {/* 外側（frame）をまとめて引っ込める。戻す手段はshortcutのみ。 */}
          <button
            class="dock-toggle" classList={{ active: props.frameHidden }}
            title={`外側を引っ込める (${mod}Z)`} onClick={props.onToggleFrame}
          >
            <Fullscreen {...iconSize} />
          </button>
        </div>
      </div>
    </>
  );
}

// 現在のCore名＋状態ドットのボタン。開くとCore一覧（最終位置へ切替）と
// 「Coreの管理」（/ の一覧画面へ）を出す。
function CoreSwitch(props: { coreKey: string; core: () => CoreEntry | undefined }) {
  const host = useShellHost();
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);
  const [cores] = createResource(open, (isOpen) =>
    isOpen ? host.listCores() : Promise.resolve([]),
  );

  let wrap: HTMLDivElement | undefined;
  createEffect(() => {
    if (!open()) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrap && !wrap.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
  });

  return (
    <div class="core-switch" ref={wrap}>
      <button class="shell-tool core-switch-btn" onClick={() => setOpen(!open())}>
        <span class={`dot ${dotClass(props.core()?.status)}`} />
        {props.core()?.name ?? props.coreKey}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      <Show when={open()}>
        <div class="shell-core-menu">
          <For each={cores() ?? []}>
            {(entry) => (
              <button
                class="shell-core-item"
                classList={{ active: entry.key === props.coreKey }}
                onClick={() => {
                  setOpen(false);
                  if (entry.key !== props.coreKey) navigate(`/${entry.key}/`);
                }}
              >
                <span class={`dot ${dotClass(entry.status)}`} />
                <span class="name">{entry.name}</span>
                <span class="status">{entry.status}</span>
              </button>
            )}
          </For>
          <div class="menu-sep" />
          <button class="shell-core-item" onClick={() => { setOpen(false); navigate("/"); }}>
            Coreの管理
          </button>
        </div>
      </Show>
    </div>
  );
}

// system→light→darkと回すボタン。systemはOSの明暗に追従する。
const themeOrder: ThemeMode[] = ["system", "light", "dark"];
const themeLabel: Record<ThemeMode, string> = { system: "OSに合わせる", light: "Light", dark: "Dark" };

export function ThemeSwitch() {
  const [mode, setMode] = createSignal<ThemeMode>(loadTheme());
  const cycle = () => {
    const next = themeOrder[(themeOrder.indexOf(mode()) + 1) % themeOrder.length];
    applyTheme(next);
    setMode(next);
  };
  return (
    <button class="shell-tool" title={`テーマ: ${themeLabel[mode()]}`} onClick={cycle}>
      <Switch fallback={<Monitor {...iconSize} />}>
        <Match when={mode() === "light"}><Sun {...iconSize} /></Match>
        <Match when={mode() === "dark"}><Moon {...iconSize} /></Match>
      </Switch>
    </button>
  );
}
