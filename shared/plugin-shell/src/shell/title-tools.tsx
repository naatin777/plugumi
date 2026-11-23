// titleのtool群。左: Area list開閉 + Core switcher、
// 中央（work区間）: 「+」・dock開閉・Sub開閉、
// 右: 両サイド畳み・テーマ・背景・設定。pillの下限は中身の実測幅。
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import { useShell, type AreaController } from "./controller.tsx";
import { ToolButton } from "./tool-button.tsx";
import { nextTheme } from "../theme.ts";
import {
  IconAreaList, IconSub, IconSides, IconPlus,
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
        label="Area list" keep
        pressed={shell.sideShown()}
        onClick={() => shell.toggleSide()}
      >
        <IconAreaList />
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

// 列ごとの開閉ボタンを持たせるため、work区間はMain/Subで別segment。
// dockボタンはそのsegmentの列（slot）にだけ効く。実効の開閉は
// AreaControllerが幅（inline/drawer）に応じて返す。
function DockButtons(props: { area: AreaController }): JSX.Element {
  return (
    <>
      <ToolButton
        label="左の領域" keep pressed={props.area.dockShown("left")}
        onClick={() => props.area.toggleDock("left")}
      >
        <IconDockLeft />
      </ToolButton>
      <ToolButton
        label="下の領域" keep pressed={props.area.dockShown("bottom")}
        onClick={() => props.area.toggleDock("bottom")}
      >
        <IconDockBottom />
      </ToolButton>
      <ToolButton
        label="右の領域" keep pressed={props.area.dockShown("right")}
        onClick={() => props.area.toggleDock("right")}
      >
        <IconDockRight />
      </ToolButton>
    </>
  );
}

export function TitleSegmentMain(props: { area: AreaController }): JSX.Element {
  const shell = useShell();
  // crumbはMainに表示中のArea（URLのpath）。
  const mainPath = () => shell.mainRef()?.path ?? [];
  const crumbTo = (depth: number) =>
    `/${shell.coreKey()}/${shell.project()}/${mainPath()
      .slice(0, depth).map(encodeURIComponent).join("/")}/`;
  return (
    <>
      <nav class="bar-crumb" aria-label="現在位置">
        <Show
          when={shell.shellSize() === "compact"}
          fallback={
            <>
              <Crumb label={shell.project()} to={crumbTo(0)} />
              <For each={mainPath()}>
                {(name, i) => (
                  <>
                    <span class="bar-crumb-sep">/</span>
                    <Crumb label={name} to={crumbTo(i() + 1)} />
                  </>
                )}
              </For>
            </>
          }
        >
          {/* 狭いときは末尾のArea名だけ出す（階層は省く）。 */}
          <Crumb
            label={mainPath()[mainPath().length - 1] ?? shell.project()}
            to={crumbTo(mainPath().length)}
          />
        </Show>
      </nav>
      <ToolButton
        label="Panelを開く"
        // titleの「+」はMainのAreaへ足す（leaf指定をリセットしてから開く）。
        // popovertargetを併用するとtoggleとshowPopoverが二重に効いて
        // 閉じてしまうので、onClickから開く。
        onClick={() => shell.openPicker(props.area)}
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
                  shell.pickPanel(entry);
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
        onClick={() => shell.openPicker(props.area)}
      >
        <IconSearch size={12} />
        <span class="bar-search-text">検索</span>
        <span class="bar-search-key">⌘K</span>
      </button>
      <span class="bar-flex" />
      <DockButtons area={props.area} />
    </>
  );
}

// Sub列のsegment。SubのArea crumb・「+」・Sub用のdock開閉・右端のSub開閉。
// Subが閉じている（またはSub自体がdrawerの）ときは開閉ボタンだけの
// 小さなsegmentになる。
export function TitleSegmentSub(props: { area: AreaController }): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  // drawer化している間はcrumb等を出さない。Subはcenterだけの表示なので
  // dock開閉ボタンは持たない（crumbと「+」だけ）。
  const detailed = () => !shell.subDrawerMode() && shell.subShown();
  const crumb = () => {
    const ref = shell.subRef();
    return ref ? `${ref.project} / ${ref.path.join("/")}` : "Sub";
  };
  const goMain = (event: MouseEvent) => {
    event.preventDefault();
    const ref = shell.subRef();
    if (!ref) return;
    navigate(`/${shell.coreKey()}/${ref.project}/` +
      `${ref.path.map(encodeURIComponent).join("/")}/`);
  };
  return (
    <>
      <Show when={detailed()}>
        <a class="bar-crumb-item" href="#" onClick={goMain}>
          {crumb()}
        </a>
        <ToolButton
          label="Panelを開く"
          onClick={() => shell.openPicker(props.area)}
        >
          <IconPlus />
        </ToolButton>
      </Show>
    </>
  );
}

// 両サイド・テーマ・背景の3操作。compactでは重なりを避けるため
// 「…」メニューに畳む。
function MiscButtons(): JSX.Element {
  const shell = useShell();
  const themeIcon = () => {
    const mode = shell.prefs().theme;
    return mode === "system" ? <IconThemeSystem /> : mode === "light" ? <IconThemeLight /> : <IconThemeDark />;
  };
  return (
    <>
      {/* 両端の列（Area list＋Sub）をまとめて畳む。 */}
      <ToolButton
        label="両サイド" pressed={shell.prefs().sideHidden}
        // 一時drawerもまとめて畳む。
        onClick={() => {
          shell.closeDrawers();
          shell.updatePrefs((prefs) => { prefs.sideHidden = !prefs.sideHidden; });
        }}
      >
        <IconSides />
      </ToolButton>
      <span class="tool-sep" />
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
    </>
  );
}

export function TitleToolsRight(): JSX.Element {
  const shell = useShell();
  let menu!: HTMLDivElement;
  return (
    <>
      {/* Sub開閉は右pillの先頭（Sub列寄り）で固定 — Sub列の有無で
          segment側が伸縮してもボタンの位置は変わらない。 */}
      <ToolButton
        label="Sub" keep pressed={shell.subShown()}
        onClick={() => shell.toggleSub()}
      >
        <IconSub />
      </ToolButton>
      <span class="tool-sep" />
      <Show
        when={shell.shellSize() === "compact"}
        fallback={<MiscButtons />}
      >
        {/* compactでは両サイド・テーマ・もやを「…」にまとめる。
            anchor()はこの環境ではimplicit anchorが解決しないので、
            開くときにボタンのrectからfixedで「真下・右揃え」に置く。 */}
        <button
          class="icon-button" aria-label="その他" popovertarget="misc-menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            menu.style.top = `${rect.bottom + 4}px`;
            menu.style.right = `${window.innerWidth - rect.right}px`;
          }}
        >
          …
        </button>
        <div
          class="misc-menu" id="misc-menu" popover="auto" ref={menu}
          onClick={(event) => event.currentTarget.hidePopover()}
        >
          <MiscButtons />
        </div>
      </Show>
      <ToolButton label="設定">
        <IconSettings />
      </ToolButton>
    </>
  );
}
