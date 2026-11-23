// titleのtool群。左: sidebar開閉 + Core switcher、
// 中央（work区間）: 「+」・dock開閉・zen、
// 右: テーマ・背景・pinned開閉。pillの下限は中身の実測幅。
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import { useShell } from "./controller.tsx";
import { ToolButton } from "./tool-button.tsx";
import { nextTheme } from "../theme.ts";
import {
  IconSidebar, IconPinned, IconZen, IconPlus,
  IconDockLeft, IconDockBottom, IconDockRight,
  IconThemeSystem, IconThemeLight, IconThemeDark,
  IconSearch, IconSettings, IconAurora,
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
      <ToolButton
        label="サイドバー"
        pressed={shell.prefs().sidebarOpen}
        onClick={() => shell.updatePrefs((prefs) => { prefs.sidebarOpen = !prefs.sidebarOpen; })}
      >
        <IconSidebar />
      </ToolButton>
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
      <ToolButton
        label="Panelを開く"
        // titleの「+」はfocused leafへ足す（leaf指定をリセットしてから開く）。
        // popovertargetを併用するとtoggleとshowPopoverが二重に効いて
        // 閉じてしまうので、onClickから開く。
        onClick={() => shell.openPicker()}
      >
        <IconPlus />
      </ToolButton>
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
      {/* zen中はdockを出せないので開閉ボタンも隠す。 */}
      <Show when={!shell.prefs().frameHidden}>
        <ToolButton
          label="左の領域" pressed={shell.prefs().dockOpen.left}
          onClick={() => toggleDock("left")}
        >
          <IconDockLeft />
        </ToolButton>
        <ToolButton
          label="下の領域" pressed={shell.prefs().dockOpen.bottom}
          onClick={() => toggleDock("bottom")}
        >
          <IconDockBottom />
        </ToolButton>
        <ToolButton
          label="右の領域" pressed={shell.prefs().dockOpen.right}
          onClick={() => toggleDock("right")}
        >
          <IconDockRight />
        </ToolButton>
        <span class="title-gap" />
      </Show>
      <ToolButton
        label="zen" pressed={shell.prefs().frameHidden}
        onClick={() => shell.updatePrefs((prefs) => { prefs.frameHidden = !prefs.frameHidden; })}
      >
        <IconZen />
      </ToolButton>
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
      <ToolButton
        label="テーマ"
        onClick={() => shell.updatePrefs((prefs) => { prefs.theme = nextTheme(prefs.theme); })}
      >
        {themeIcon()}
      </ToolButton>
      <ToolButton
        label="背景のもや" pressed={shell.prefs().aurora}
        onClick={() => shell.updatePrefs((prefs) => { prefs.aurora = !prefs.aurora; })}
      >
        <IconAurora />
      </ToolButton>
      <ToolButton
        label="pinned" pressed={shell.prefs().pinnedOpen}
        onClick={() => shell.updatePrefs((prefs) => { prefs.pinnedOpen = !prefs.pinnedOpen; })}
      >
        <IconPinned />
      </ToolButton>
      <ToolButton label="設定">
        <IconSettings />
      </ToolButton>
    </>
  );
}
