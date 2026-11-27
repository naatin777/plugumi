// sidebar（Shell固有のナビ領域。Panelではない）= Area list。
// 上部にProject切替、下にMain/Sub/Detachの3セクション。表示するAreaは今の
// Projectの全Areaから導出する（隠しAreaはない）。行のclickでMainは
// URL切替、Subは選択、Detachは別windowを開く（Electronのみ — bridgeが
// 無い環境ではURL移動にフォールバック）。作成はinline入力、削除は2段階の
// inline確認にする（prompt/confirmはElectronで使えないため）。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import type { ListSlot, FlatArea } from "../layout/area-list.ts";
import { detachedAreas, mainAreas, pathKey, selectSub, subAreas, toDetach, toMain, toSub } from "../layout/area-list.ts";
import { useShell } from "./controller.tsx";
import { openPopover } from "./popover.ts";
import { NameForm, ConfirmButton } from "./inline.tsx";
import { Resizer } from "./resizer.tsx";
import { IconChevronRight, IconPlus } from "../icons.tsx";
import styles from "./sidebar.module.css";

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
          // drawerでも同じsidebarWidthを共有する。上限はdrawerの上限
          // （画面幅の85%）でclampし、越えた値は保存しない。
          const max = shell.sideDrawerMode() ? 0.85 * innerWidth : 640;
          const clamped = Math.min(max, Math.max(120, size));
          shell.updatePrefs((prefs) => {
            prefs.sidebarWidth = clamped;
          });
        }}
      />
      <nav class={styles["sidebar"]} data-part="sidebar">
        <ProjectSwitcher />
        <AreaSlot slot="main" label="Main" />
        <AreaSlot slot="sub" label="Sub" />
        <AreaSlot slot="detach" label="Detach" />
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
    <div>
      <button
        class={styles["project-switcher-button"]}
        onClick={(event) => {
          setAdding(false);
          openPopover(menu, event.currentTarget);
        }}
      >
        <span class={styles["project-switcher-name"]}>
          {shell.projectTree()?.title ?? shell.project()}
        </span>
        <IconChevronRight size={12} />
      </button>
      <div class={styles["project-menu"]} data-part="popover" popover="auto" ref={menu}>
        <For each={shell.projects()}>
          {(item) => (
            <button
              class={{ [styles["area-menu-item"]]: true, [styles["selected"]]: item.key === shell.project() }}
              onClick={(event) => {
                closePopover(event);
                navigate(`/${shell.coreKey()}/${item.key}/`);
              }}
            >
              {item.title}
            </button>
          )}
        </For>
        <Show
          when={adding()}
          fallback={
            <button class={styles["area-menu-item"]} onClick={() => setAdding(true)}>
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
// Main = sub/detachedに無い全Area（tree順・入れ子はインデント）、
// Sub = subの順、Detach = detachedの順。
function AreaSlot(props: { slot: ListSlot; label: string }): JSX.Element {
  const shell = useShell();
  const areas = () => shell.projectTree()?.areas ?? [];
  const entries = () =>
    props.slot === "main"
      ? mainAreas(shell.areaList(), areas())
      : props.slot === "sub"
        ? subAreas(shell.areaList(), areas())
        : detachedAreas(shell.areaList(), areas());
  const emptyLabel = () =>
    props.slot === "main" ? "Areaがありません"
      : props.slot === "sub" ? "Subに移したAreaはありません"
      : "Detachに移したAreaはありません";
  return (
    // Detach節はwindowを開ける環境（Electron）かdetach済みのAreaが
    // あるときだけ出す — webで空のまま残しても辿れない。
    <Show when={props.slot !== "detach" || shell.host.windows !== null || entries().length > 0}>
      <section class={styles["area-slot"]}>
        <p class={styles["nav-label"]}>{props.label}</p>
        <Show when={entries().length === 0}>
          <p class={styles["nav-empty"]}>{emptyLabel()}</p>
        </Show>
        <For each={entries()}>
          {(area) => <AreaRow slot={props.slot} area={area} />}
        </For>
        <AreaCreate slot={props.slot} parent={[]} />
      </section>
    </Show>
  );
}

const samePath = (a: string[] | undefined, b: string[]) =>
  !!a && a.length === b.length && a.every((part, index) => part === b[index]);

// Area1行。clickでMainはURL移動・Subは選択・Detachは別windowを開く。
// prop名はrefにしない — refはJSXの予約属性で、転送の対象になる。
function AreaRow(props: { slot: ListSlot; area: FlatArea }): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  const key = () => pathKey(props.area.path);
  const title = () => props.area.title;
  const href = useHref(() =>
    `/${shell.coreKey()}/${shell.project()}/` +
    `${props.area.path.map(encodeURIComponent).join("/")}/`);
  // 強調は「そのAreaが実際にそのslotに出ているか」で決める。
  // MainはURL（areaPath）が正本。Detachはwindowの有無を追わないので
  // 常に未選択。
  const selected = () =>
    props.slot === "main"
      ? samePath(shell.areaPath(), props.area.path)
      : props.slot === "sub" && shell.areaList().selectedSub === key();
  const [addingChild, setAddingChild] = createSignal(false);

  const open = (event: MouseEvent) => {
    event.preventDefault();
    if (props.slot === "main") {
      navigate(href());
      return;
    }
    if (props.slot === "detach") {
      const windows = shell.host.windows;
      if (windows) windows.open(`${href()}?window=detached`);
      else navigate(href()); // bridgeが無い環境ではMain表示にフォールバック
      return;
    }
    shell.applyAreaList((state) => selectSub(state, key()));
    shell.updatePrefs((prefs) => { prefs.subOpen = true; });
  };

  const moveToMain = (event: MouseEvent) => {
    closePopover(event);
    shell.applyAreaList((state) => toMain(state, key()));
    navigate(href());
  };

  const moveToSub = (event: MouseEvent) => {
    closePopover(event);
    shell.applyAreaList((state) => toSub(state, key()));
    shell.updatePrefs((prefs) => { prefs.subOpen = true; });
  };

  const moveToDetach = (windows: { open(path: string): void }) => (event: MouseEvent) => {
    closePopover(event);
    shell.applyAreaList((state) => toDetach(state, key()));
    windows.open(`${href()}?window=detached`);
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
        class={{ [styles["area-row"]]: true, [styles["selected"]]: selected() }}
          data-part="area-list-row"
        style={{ "padding-left": `${props.area.depth * 12}px` }}
      >
        <a href={href()} onClick={open}>{title()}</a>
        <button
          class={styles["area-menu-button"]}
          aria-label="Areaのメニュー"
          onClick={(event) => {
            event.stopPropagation();
            openPopover(menu, event.currentTarget, "end");
          }}
        >
          …
        </button>
        <div class={styles["area-menu"]} data-part="popover" popover="auto" ref={menu}>
          {/* 配置の移動はMain/Sub/Detachの3方向。自分のslotは出さない。 */}
          <Show when={props.slot !== "main"}>
            <button class={styles["area-menu-item"]} onClick={moveToMain}>
              Mainへ
            </button>
          </Show>
          <Show when={props.slot !== "sub"}>
            <button class={styles["area-menu-item"]} onClick={moveToSub}>
              Subへ
            </button>
          </Show>
          {/* detachはElectronのみ（host.windowsがnullなら出さない）。 */}
          <Show when={props.slot !== "detach" && shell.host.windows}>
            {(windows) => (
              <button class={styles["area-menu-item"]} onClick={moveToDetach(windows())}>
                別windowで開く
              </button>
            )}
          </Show>
          <button
            class={styles["area-menu-item"]}
            onClick={(event) => {
              closePopover(event);
              setAddingChild(true);
            }}
          >
            子Areaを追加
          </button>
          <ConfirmButton
            class={`${styles["area-menu-item"]} ${styles["danger"]}`}
            label="Areaを削除"
            confirmLabel={`「${title()}」とその下のAreaを削除します`}
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
        <div class={styles["area-child-form"]}>
          <NameForm
            label={`「${title()}」の子Area名`}
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
        <button class={styles["area-add"]} onClick={() => setAdding(true)}>
          <IconPlus size={12} /> Areaを追加
        </button>
      }
    >
      <NameForm
        label="Area名"
        submit={async (title) => {
          const key = await shell.createArea(shell.project(), props.parent, title);
          const placement = pathKey([key]);
          const path = `/${shell.coreKey()}/${shell.project()}/${encodeURIComponent(key)}/`;
          if (props.slot === "sub") {
            shell.applyAreaList((state) => toSub(state, placement));
            shell.updatePrefs((prefs) => { prefs.subOpen = true; });
          } else if (props.slot === "detach") {
            shell.applyAreaList((state) => toDetach(state, placement));
            shell.host.windows?.open(`${path}?window=detached`);
          } else {
            navigate(path);
          }
          setAdding(false);
        }}
        cancel={() => setAdding(false)}
      />
    </Show>
  );
}
