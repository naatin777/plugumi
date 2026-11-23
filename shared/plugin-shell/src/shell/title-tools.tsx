// titleのtool群。左: sidebar開閉 + Core switcher、
// 中央（work区間）: 「+」・dock開閉・zen、
// 右: テーマ・pinned開閉。固定設計幅内に収める。
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import { useShell } from "./controller.tsx";
import { nextTheme } from "../theme.ts";
import {
  IconSidebar, IconPinned, IconZen, IconPlus,
  IconDockLeft, IconDockBottom, IconDockRight,
  IconThemeSystem, IconThemeLight, IconThemeDark,
  IconSearch, IconSettings,
} from "../icons.tsx";

// popover内の項目を選んだら閉じる（選択後も残ると画面を覆う）。
const closePopover = (event: MouseEvent) => {
  const trigger = event.currentTarget as HTMLElement | null;
  trigger?.closest<HTMLElement>("[popover]")?.hidePopover();
};

export function TitleToolsLeft(): JSX.Element {
  const shell = useShell();
  return (
    <>
      <button
        class="icon-button"
        aria-label="サイドバー"
        aria-pressed={shell.prefs().sidebarOpen ? "true" : "false"}
        onClick={() => shell.updatePrefs((prefs) => { prefs.sidebarOpen = !prefs.sidebarOpen; })}
      >
        <IconSidebar />
      </button>
      <CoreSwitcher />
    </>
  );
}

function CoreSwitcher(): JSX.Element {
  const shell = useShell();
  const statusOf = (status: string | undefined) =>
    status === "connected" ? "connected" : status === "connecting" ? "connecting" : "error";
  return (
    <div class="core-switcher">
      <button class="core-button" popovertarget="core-menu">
        <span
          class="status-dot"
          data-status={statusOf(shell.core()?.status)}
          aria-hidden="true"
        />
        <span class="core-name">{shell.core()?.name || shell.core()?.key || "Core"}</span>
      </button>
      <div class="core-menu" id="core-menu" popover="auto">
        <For each={shell.cores()}>
          {(entry) => <CoreMenuItem key={entry.key} name={entry.name} status={statusOf(entry.status)} />}
        </For>
        <CoreMenuItem key="" name="Core の管理" status="" />
      </div>
    </div>
  );
}

function CoreMenuItem(props: { key: string; name: string; status: string }): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  const href = useHref(() => (props.key ? `/${props.key}/` : "/"));
  const select = (event: MouseEvent) => {
    event.preventDefault();
    closePopover(event);
    if (props.key && props.key !== shell.coreKey()) navigate(`/${props.key}/`);
    if (!props.key) navigate("/");
  };
  return (
    <a
      class={{ "core-menu-item": true, selected: props.key !== "" && props.key === shell.coreKey() }}
      href={href()}
      onClick={select}
    >
      <Show when={props.status}>
        <span class="status-dot" data-status={props.status} aria-hidden="true" />
      </Show>
      <span class="core-name">{props.name || props.key}</span>
    </a>
  );
}

// work帯のロケーション。projectとarea階層をcrumbとして出す
// （coreはchrome帯のswitcherが担うのでここには出さない）。
function Crumb(props: { label: string; to: string }): JSX.Element {
  const href = useHref(() => props.to);
  return <a class="bar-crumb-item" href={href()}>{props.label}</a>;
}

export function TitleToolsCenter(): JSX.Element {
  const shell = useShell();
  const toggleDock = (kind: "left" | "bottom" | "right") =>
    shell.updatePrefs((prefs) => {
      prefs.dockOpen = { ...prefs.dockOpen, [kind]: !prefs.dockOpen[kind] };
    });
  const crumbTo = (depth: number) =>
    `/${shell.coreKey()}/${shell.project()}/${shell.areaPath()
      .slice(0, depth).map(encodeURIComponent).join("/")}/`;
  return (
    <>
      <nav class="bar-crumb" aria-label="現在位置">
        <Crumb label={shell.project()} to={crumbTo(0)} />
        <For each={shell.areaPath()}>
          {(name, i) => (
            <>
              <span class="bar-crumb-sep">/</span>
              <Crumb label={name} to={crumbTo(i() + 1)} />
            </>
          )}
        </For>
      </nav>
      <button
        class="icon-button" aria-label="Panelを開く"
        // titleの「+」はfocused leafへ足す（leaf指定をリセットしてから開く）。
        // popovertargetを併用するとtoggleとshowPopoverが二重に効いて
        // 閉じてしまうので、onClickから開く。
        onClick={() => shell.openPicker()}
      >
        <IconPlus />
      </button>
      <div class="panel-picker" id="panel-picker" popover="auto" ref={shell.bindPicker}>
        <Show when={shell.panels().length > 0} fallback={<p class="picker-empty">開けるPanelがありません</p>}>
          <For each={shell.panels()}>
            {(entry) => (
              <button
                class="picker-item"
                onClick={(event) => {
                  closePopover(event);
                  shell.openPanel(entry.pluginId, entry.panelId, shell.pickerTarget() ?? undefined);
                }}
              >
                {entry.title}
                <span class="picker-plugin">{entry.pluginId}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
      {/* 見えない空白（Firefoxのflexible space相当）。左右の群は
          barの幅に関係なく端に固定され、中央だけが真ん中に留まる。 */}
      <span class="bar-flex" />
      {/* 仮: 中身はまだないので、ひとまずpanel pickerを開くだけ。 */}
      <button
        class="bar-search" aria-label="検索"
        onClick={() => shell.openPicker()}
      >
        <IconSearch size={12} />
        検索
        <span class="bar-search-key">⌘K</span>
      </button>
      <span class="bar-flex" />
      <button
        class="icon-button" aria-label="左の領域"
        aria-pressed={shell.prefs().dockOpen.left ? "true" : "false"}
        onClick={() => toggleDock("left")}
      >
        <IconDockLeft />
      </button>
      <button
        class="icon-button" aria-label="下の領域"
        aria-pressed={shell.prefs().dockOpen.bottom ? "true" : "false"}
        onClick={() => toggleDock("bottom")}
      >
        <IconDockBottom />
      </button>
      <button
        class="icon-button" aria-label="右の領域"
        aria-pressed={shell.prefs().dockOpen.right ? "true" : "false"}
        onClick={() => toggleDock("right")}
      >
        <IconDockRight />
      </button>
      <span class="title-gap" />
      <button
        class="icon-button"
        aria-label="zen"
        aria-pressed={shell.prefs().frameHidden ? "true" : "false"}
        onClick={() => shell.updatePrefs((prefs) => { prefs.frameHidden = !prefs.frameHidden; })}
      >
        <IconZen />
      </button>
    </>
  );
}

export function TitleToolsRight(): JSX.Element {
  const shell = useShell();
  const themeIcon = () => {
    const mode = shell.prefs().theme;
    return mode === "system" ? <IconThemeSystem /> : mode === "light" ? <IconThemeLight /> : <IconThemeDark />;
  };
  return (
    <>
      <button
        class="icon-button"
        aria-label="テーマ"
        onClick={() => shell.updatePrefs((prefs) => { prefs.theme = nextTheme(prefs.theme); })}
      >
        {themeIcon()}
      </button>
      <button
        class="icon-button"
        aria-label="pinned"
        aria-pressed={shell.prefs().pinnedOpen ? "true" : "false"}
        onClick={() => shell.updatePrefs((prefs) => { prefs.pinnedOpen = !prefs.pinnedOpen; })}
      >
        <IconPinned />
      </button>
      <button class="icon-button" aria-label="設定">
        <IconSettings />
      </button>
    </>
  );
}
