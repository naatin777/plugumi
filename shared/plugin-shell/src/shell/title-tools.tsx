// titleのtool群。左: Area list開閉 + Core switcher、
// 中央（work区間）: 「+」・検索・dock開閉、
// 右: Sub開閉だけ（先頭＝Sub列寄りに固定）。pillの下限は中身の実測幅。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import { useShell, type AreaController } from "./controller.tsx";
import { openPopover } from "./popover.ts";
import { ToolButton } from "./tool-button.tsx";
import {
  IconAreaList, IconSub, IconPlus,
  IconDockLeft, IconDockBottom, IconDockRight,
  IconSearch,
} from "../icons.tsx";
import controlStyles from "./controls.module.css";
import styles from "./title-tools.module.css";

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
  const [menu, setMenu] = createSignal<HTMLElement>(null!);
  const statusOf = (status: string | undefined) =>
    status === "connected" ? "connected" : status === "connecting" ? "connecting" : "error";
  return (
    <div class={controlStyles["core-switcher"]}>
      <button
        class={controlStyles["core-button"]}
        onClick={(event) => openPopover(menu(), event.currentTarget)}
      >
        <span
          class={controlStyles["status-dot"]}
          data-status={statusOf(shell.core()?.status)}
          aria-hidden="true"
        />
        <span class={controlStyles["core-name"]}>{shell.core()?.name || shell.core()?.key || "Core"}</span>
      </button>
      <div class={controlStyles["core-menu"]} id="core-menu" data-part="popover" popover="auto" ref={setMenu}>
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
      class={controlStyles["core-menu-item"]}
      href={href()}
      onClick={select}
    >
      <Show when={props.status}>
        <span class={controlStyles["status-dot"]} data-status={props.status} aria-hidden="true" />
      </Show>
      <span class={controlStyles["core-name"]}>{props.name || props.key}</span>
    </a>
  );
}

// work帯のロケーション。projectとarea階層をcrumbとして出す
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
  return (
    <>
      <ToolButton
        label="Panelを開く"
        // titleの「+」はMainのAreaへ足す（leaf指定をリセットしてから開く）。
        // popovertargetを併用するとtoggleとshowPopoverが二重に効いて
        // 閉じてしまうので、onClickから開く。
        onClick={(event) => shell.openPicker(props.area, undefined, event.currentTarget as HTMLElement)}
      >
        <IconPlus />
      </ToolButton>
      <div class={controlStyles["panel-picker"]} id="panel-picker" data-part="picker" popover="auto" ref={shell.bindPicker}>
        <Show when={shell.panels().length > 0} fallback={<p class={controlStyles["picker-empty"]}>開けるPanelがありません</p>}>
          <For each={shell.panels()}>
            {(entry) => (
              <button
                class={controlStyles["picker-item"]}
                onClick={(event) => {
                  closePopover(event);
                  shell.pickPanel(entry);
                }}
              >
                {entry.title}
                <span class={controlStyles["picker-plugin"]}>{entry.pluginId}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
      {/* 見えない空白（Firefoxのflexible space相当）。左右の群は
          barの幅に関係なく端に固定され、中央だけが真ん中に留まる。 */}
      <span class={styles["bar-flex"]} />
      {/* 仮: 中身はまだないので、ひとまずpanel pickerを開くだけ。 */}
      <button
        class={styles["bar-search"]} aria-label="検索"
        onClick={(event) =>
          shell.openPicker(props.area, undefined, event.currentTarget, "center")}
      >
        <IconSearch size={12} />
        <span class={styles["bar-search-text"]}>検索</span>
        <span class={styles["bar-search-key"]}>⌘K</span>
      </button>
      <span class={styles["bar-flex"]} />
      <DockButtons area={props.area} />
    </>
  );
}

// Sub列のsegment。Subはcenterだけの表示なので「+」だけを持つ
// （開閉は右端のSubボタンが担い、位置は固定）。
export function TitleSegmentSub(props: { area: AreaController }): JSX.Element {
  const shell = useShell();
  // drawer化している間は「+」も出さない。
  const detailed = () => !shell.subDrawerMode() && shell.subShown();
  return (
    <Show when={detailed()}>
      <ToolButton
        label="Panelを開く"
        onClick={(event) => shell.openPicker(props.area, undefined, event.currentTarget as HTMLElement)}
      >
        <IconPlus />
      </ToolButton>
    </Show>
  );
}

export function TitleToolsRight(): JSX.Element {
  const shell = useShell();
  return (
    // Sub開閉は右pillの先頭（Sub列寄り）で固定 — Sub列の有無で
    // segment側が伸縮してもボタンの位置は変わらない。
    <ToolButton
      label="Sub" keep pressed={shell.subShown()}
      onClick={() => shell.toggleSub()}
    >
      <IconSub />
    </ToolButton>
  );
}
