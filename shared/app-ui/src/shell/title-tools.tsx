// titleのtool群。左: Area list開閉 + Core switcher、
// 中央（work区間）: 「+」、
// 右: Sub開閉だけ（先頭＝Sub列寄りに固定）。pillの下限は中身の実測幅。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import { useShell, type AreaController } from "./controller.tsx";
import { openPopover } from "./popover.ts";
import { ToolButton } from "./tool-button.tsx";
import { IconAreaList, IconSub, IconPlus } from "../icons.tsx";
import controlStyles from "./controls.module.css";

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
      <div class={`plugumi-list ${controlStyles["core-menu"]}`} id="core-menu" data-part="popover" popover="auto" ref={setMenu}>
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
      class="plugumi-list-item"
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
export function TitleSegmentMain(props: { area: AreaController }): JSX.Element {
  const shell = useShell();
  return (
    <>
      <ToolButton
        label="Panelを開く"
        // titleの「+」は最後に触ったArea（無ければMain）へ足す。
        // popovertargetを併用するとtoggleとshowPopoverが二重に効いて
        // 閉じてしまうので、onClickから開く。
        onClick={(event) =>
          shell.openPicker(shell.focusedArea() ?? props.area, undefined, event.currentTarget as HTMLElement)}
      >
        <IconPlus />
      </ToolButton>
      <div class={`plugumi-list ${controlStyles["panel-picker"]}`} id="panel-picker" data-part="picker" popover="auto" ref={shell.bindPicker}>
        <Show when={shell.panels().length > 0} fallback={<p class={controlStyles["picker-empty"]}>開けるPanelがありません</p>}>
          <For each={shell.panels()}>
            {(entry) => (
              <button
                class="plugumi-list-item"
                onClick={(event) => {
                  closePopover(event);
                  shell.pickPanel(entry);
                }}
              >
                {entry.title}
                <span class="plugumi-list-item-meta">{entry.providerId}</span>
              </button>
            )}
          </For>
        </Show>
      </div>
      {/* 見えない空白（Firefoxのflexible space相当）。左右の群は
          barの幅に関係なく端に固定され、中央だけが真ん中に留まる。 */}
    </>
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
