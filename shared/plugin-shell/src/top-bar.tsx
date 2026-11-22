// 最上段のOS帯（.shell-os）に置くShell固有のUI。Pluginからはカスタマイズ不可。
// 左: サイドバー開閉 + Core switcher、右: 検索・メニュー・設定の置き場所（未実装）。
import { useNavigate } from "@solidjs/router";
import { ChevronDown, Menu, Monitor, Moon, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Search, Settings, Sun } from "lucide-solid";
import { createEffect, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { useShellHost, type CoreEntry, type CoreStatus } from "./host";
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

export function TopBar(props: {
  coreKey: string;
  core: () => CoreEntry | undefined;
  sideOpen: () => boolean;
  onToggleSide: () => void;
  pinnedOpen: () => boolean;
  onTogglePinned: () => void;
}) {
  return (
    <>
      <button
        class="shell-tool"
        title="サイドバー"
        onClick={() => props.onToggleSide()}
      >
        <Show when={props.sideOpen()} fallback={<PanelLeft {...iconSize} />}>
          <PanelLeftClose {...iconSize} />
        </Show>
      </button>
      <CoreSwitch coreKey={props.coreKey} core={props.core} />
      <span class="shell-top-spacer" />
      <button class="shell-tool" disabled title="検索（準備中）"><Search {...iconSize} /></button>
      <button class="shell-tool" disabled title="メニュー（準備中）"><Menu {...iconSize} /></button>
      <button class="shell-tool" disabled title="設定（準備中）"><Settings {...iconSize} /></button>
      <ThemeSwitch />
      <button
        class="shell-tool"
        title="Pinned"
        onClick={() => props.onTogglePinned()}
      >
        <Show when={props.pinnedOpen()} fallback={<PanelRight {...iconSize} />}>
          <PanelRightClose {...iconSize} />
        </Show>
      </button>
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

function ThemeSwitch() {
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
