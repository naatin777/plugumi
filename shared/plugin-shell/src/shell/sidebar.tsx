// sidebar（Shell固有のナビ領域。Panelではない）= Area list。
// 上部にProject切替、下にMain/Subの2セクション。表示するAreaは今の
// Projectの全Areaから導出する（隠しAreaはない）。行のclickでMainは
// URL切替、Subは選択。作成はinline入力、削除は2段階のinline確認にする
// （prompt/confirmはElectronで使えないため）。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import type { AreaDisplay, ListSlot, FlatArea } from "../layout/area-list.ts";
import { mainAreas, pathKey, selectSub, setDisplay, subAreas, toMain, toSub } from "../layout/area-list.ts";
import { useShell } from "./controller.tsx";
import { NameForm, ConfirmButton } from "./inline.tsx";
import { Resizer } from "./resizer.tsx";
import { IconChevronRight, IconPlus } from "../icons.tsx";

// popover内の項目を選んだら閉じる（選択後も残ると画面を覆う）。
const closePopover = (event: MouseEvent) => {
  const trigger = event.currentTarget as HTMLElement | null;
  trigger?.closest<HTMLElement>("[popover]")?.hidePopover();
};

export function SidebarView(): JSX.Element {
  const shell = useShell();
  return (
    <>
      {/* 列の幅のresizer（溝を掴む）。 */}
      <Resizer
        axis="x"
        direction={1}
        value={() => shell.prefs().sidebarWidth}
        apply={(size) => {
          const clamped = Math.min(640, Math.max(120, size));
          shell.updatePrefs((prefs) => {
            prefs.sidebarWidth = clamped;
          });
        }}
      />
      <nav class="sidebar">
        <ProjectSwitcher />
        <AreaSlot slot="main" label="Main" />
        <AreaSlot slot="sub" label="Sub" />
      </nav>
    </>
  );
}

// 上部のProject切替。押すとProject一覧のpopover。
function ProjectSwitcher(): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  const [adding, setAdding] = createSignal(false);
  let menu!: HTMLDivElement;
  return (
    <div class="project-switcher">
      <button
        class="project-switcher-button"
        onClick={() => {
          setAdding(false);
          menu.showPopover();
        }}
      >
        <span class="project-switcher-name">{shell.project()}</span>
        <IconChevronRight size={12} />
      </button>
      <div class="project-menu" popover="auto" ref={menu}>
        <For each={shell.projects()}>
          {(item) => (
            <button
              class={{ "area-menu-item": true, selected: item.name === shell.project() }}
              onClick={(event) => {
                closePopover(event);
                navigate(`/${shell.coreKey()}/${item.name}/`);
              }}
            >
              {item.name}
            </button>
          )}
        </For>
        <Show
          when={adding()}
          fallback={
            <button class="area-menu-item" onClick={() => setAdding(true)}>
              <IconPlus size={12} /> Projectを追加
            </button>
          }
        >
          <NameForm
            label="Project名"
            submit={async (name) => {
              await shell.createProject(name);
              closePopover({ currentTarget: menu } as unknown as MouseEvent);
            }}
            cancel={() => setAdding(false)}
          />
        </Show>
      </div>
    </div>
  );
}

// 1セクション。表示するAreaはprojectTreeから導出する。
// Main = subに無い全Area（tree順・入れ子はインデント）、Sub = subの順。
function AreaSlot(props: { slot: ListSlot; label: string }): JSX.Element {
  const shell = useShell();
  const areas = () => shell.projectTree()?.areas ?? [];
  const entries = () =>
    props.slot === "main"
      ? mainAreas(shell.areaList(), areas())
      : subAreas(shell.areaList(), areas());
  return (
    <section class="area-slot">
      <p class="nav-label">{props.label}</p>
      <Show when={entries().length === 0}>
        <p class="nav-empty">
          {props.slot === "main" ? "Areaがありません" : "Subに移したAreaはありません"}
        </p>
      </Show>
      <For each={entries()}>
        {(area) => <AreaRow slot={props.slot} area={area} />}
      </For>
      <AreaCreate slot={props.slot} parent={[]} />
    </section>
  );
}

const samePath = (a: string[] | undefined, b: string[]) =>
  !!a && a.length === b.length && a.every((part, index) => part === b[index]);

// Area1行。clickでMainはURL移動・Subは選択。
// prop名はrefにしない — refはJSXの予約属性で、転送の対象になる。
function AreaRow(props: { slot: ListSlot; area: FlatArea }): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  const key = () => pathKey(props.area.path);
  const name = () => props.area.path[props.area.path.length - 1] ?? "";
  const href = useHref(() =>
    `/${shell.coreKey()}/${shell.project()}/` +
    `${props.area.path.map(encodeURIComponent).join("/")}/`);
  // 強調は「そのAreaが実際にそのslotに出ているか」で決める。
  // MainはURL（areaPath）が正本。
  const selected = () =>
    props.slot === "main"
      ? samePath(shell.areaPath(), props.area.path)
      : shell.areaList().selectedSub === key();
  const display = () =>
    shell.areaList().display[key()] ?? "full";

  const [addingChild, setAddingChild] = createSignal(false);

  const open = (event: MouseEvent) => {
    event.preventDefault();
    if (props.slot === "main") {
      navigate(href());
      return;
    }
    shell.applyAreaList((state) => selectSub(state, key()));
    shell.updatePrefs((prefs) => { prefs.subOpen = true; });
  };

  const move = (event: MouseEvent) => {
    closePopover(event);
    if (props.slot === "main") {
      shell.applyAreaList((state) => toSub(state, key()));
      shell.updatePrefs((prefs) => { prefs.subOpen = true; });
    } else {
      shell.applyAreaList((state) => toMain(state, key()));
      navigate(href());
    }
  };

  const setMode = (next: AreaDisplay) => (event: MouseEvent) => {
    closePopover(event);
    shell.applyAreaList((state) => setDisplay(state, key(), next));
  };

  const remove = () => {
    // URLが指しているArea（またはその祖先）を消すとURLが無効になるので
    // 先に入口へ戻す（controller.removeAreaも同じ判定を持つ）。
    void shell.removeArea(shell.project(), props.area.path);
  };

  let menu!: HTMLDivElement;
  return (
    <>
      <div
        class={{ "area-row": true, selected: selected() }}
        style={{ "padding-left": `${props.area.depth * 12}px` }}
      >
        <a href={href()} onClick={open}>{name()}</a>
        <button
          class="area-menu-button"
          aria-label="Areaのメニュー"
          onClick={(event) => {
            event.stopPropagation();
            menu.showPopover();
          }}
        >
          …
        </button>
        <div class="area-menu" popover="auto" ref={menu}>
          <button class="area-menu-item" onClick={move}>
            {props.slot === "main" ? "Subへ" : "Mainへ"}
          </button>
          <button
            class="area-menu-item"
            onClick={(event) => {
              closePopover(event);
              setAddingChild(true);
            }}
          >
            子Areaを追加
          </button>
          {/* Subはcenterだけの表示なので表示切替はMain行にだけ出す。 */}
          <Show when={props.slot === "main"}>
            <p class="area-menu-label">表示</p>
            <button
              class={{ "area-menu-item": true, selected: display() === "full" }}
              onClick={setMode("full")}
            >
              すべて
            </button>
            <button
              class={{ "area-menu-item": true, selected: display() === "center" }}
              onClick={setMode("center")}
            >
              centerのみ
            </button>
          </Show>
          {/* detachはElectronのみ（host.windowsがnullなら出さない）。 */}
          <Show when={shell.host.windows}>
            {(windows) => (
              <button
                class="area-menu-item"
                onClick={(event) => {
                  closePopover(event);
                  windows().open(`${href()}?window=detached`);
                }}
              >
                別windowで開く
              </button>
            )}
          </Show>
          <ConfirmButton
            class="area-menu-item danger"
            label="Areaを削除"
            confirmLabel={`「${name()}」とその下のAreaを削除します`}
            confirm={() => {
              menu.hidePopover();
              remove();
            }}
          >
            Areaを削除
          </ConfirmButton>
        </div>
      </div>
      <Show when={addingChild()}>
        <div class="area-child-form">
          <NameForm
            label={`「${name()}」の子Area名`}
            submit={async (child) => {
              await shell.createArea(shell.project(), props.area.path, child);
              setAddingChild(false);
            }}
            cancel={() => setAddingChild(false)}
          />
        </div>
      </Show>
    </>
  );
}

// 「＋ Areaを追加」= 新しいAreaの作成（parentはProject直下）。
// Subの「＋」で作ったAreaはそのままSubへ入れる。
function AreaCreate(props: { slot: ListSlot; parent: string[] }): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  const [adding, setAdding] = createSignal(false);
  return (
    <Show
      when={adding()}
      fallback={
        <button class="area-add" onClick={() => setAdding(true)}>
          <IconPlus size={12} /> Areaを追加
        </button>
      }
    >
      <NameForm
        label="Area名"
        submit={async (name) => {
          await shell.createArea(shell.project(), props.parent, name);
          const key = pathKey([name]);
          if (props.slot === "sub") {
            shell.applyAreaList((state) => toSub(state, key));
            shell.updatePrefs((prefs) => { prefs.subOpen = true; });
          } else {
            navigate(`/${shell.coreKey()}/${shell.project()}/${encodeURIComponent(name)}/`);
          }
          setAdding(false);
        }}
        cancel={() => setAdding(false)}
      />
    </Show>
  );
}
