// sidebar（Shell固有のナビ領域。Panelではない）。
// Space=Projectを札で切替え、選択中のProjectのAreaツリーを見せる。
// その下にworkspaceのpanelをMain/Sideで分けて一覧する（SigmaOSの
// sidebarと同じ形 — Main=作業面のpanel、Side=右の列に置くpanel）。
// 行はclickで選択、dragでsection間の移動（dropは各sectionが受ける）。
// Areaを選ぶとURLが変わり、Workspaceが入れ替わる。
// prompt/confirmはElectronで使えないため、作成はinline入力、
// 削除は2段階のinline確認にする。
import { For, Show, createSignal, onCleanup } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref } from "@solidjs/router";
import type { AreaTree } from "../host.tsx";
import type { PanelRef } from "../layout/model.ts";
import { allLeaves, leafOf, locationOf } from "../layout/model.ts";
import { useShell, layoutOps } from "./controller.tsx";
import { NameForm, ConfirmButton } from "./inline.tsx";
import { Resizer } from "./resizer.tsx";
import type { DropTester } from "./drag.ts";
import { surfaceAttrs, busyAttr } from "./activity.ts";
import { IconChevronRight, IconClose, IconPlus } from "../icons.tsx";

export function SidebarView(): JSX.Element {
  const shell = useShell();
  const [addingProject, setAddingProject] = createSignal(false);
  const [addingArea, setAddingArea] = createSignal(false);
  // Main = side以外の全panel（left/bottom dockとcenterのleaf）。
  const mainPanels = (): PanelRef[] => [
    ...shell.layout().left.panels,
    ...shell.layout().bottom.panels,
    ...allLeaves(shell.layout().center.root).flatMap((leaf) => leaf.panels),
  ];
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
      <div class="project-tabs">
        <For each={shell.projects()}>
          {(tree) => <ProjectTab name={tree.name} />}
        </For>
        <Show
          when={addingProject()}
          fallback={
            <button
              class="project-add"
              aria-label="Projectを作成"
              onClick={() => setAddingProject(true)}
            >
              <IconPlus size={12} />
            </button>
          }
        >
          <NameForm
            label="Project名"
            submit={async (name) => {
              await shell.createProject(name);
              setAddingProject(false);
            }}
            cancel={() => setAddingProject(false)}
          />
        </Show>
      </div>
      <div class="area-tree">
        <Show when={shell.projectTree()} fallback={<p class="area-hint">Project を作成してください</p>}>
          <AreaBranch areas={shell.projectTree()!.areas} path={[]} />
          <Show
            when={addingArea()}
            fallback={
              <button class="area-add" onClick={() => setAddingArea(true)}>
                <IconPlus size={12} /> Area を追加
              </button>
            }
          >
            <NameForm
              label="Area名"
              submit={async (name) => {
                await shell.createArea([], name);
                setAddingArea(false);
              }}
              cancel={() => setAddingArea(false)}
            />
          </Show>
        </Show>
      </div>
      <PanelSection
        label="Main"
        panels={mainPanels}
        // MainへのdropはfocusedLeafの末尾へ（leafはloadで差し替わるので
        // targetはdrop時点の値を読む）。
        dropTarget={() => ({
          region: "leaf",
          leafId: shell.layout().center.focusedLeaf,
          index: -1,
        })}
        addTarget={undefined}
      />
      <PanelSection
        label="Side"
        panels={() => shell.layout().side.panels}
        dropTarget={() => ({ region: "dock", dock: "side", index: -1 })}
        addTarget={{ region: "dock", dock: "side", index: -1 }}
      />
    </nav>
    </>
  );
}

// Main/Sideの1セクション。行リスト＋追加ボタンで、section自体が
// panelのdrop先にもなる（nav上のdragで領域を移す）。
function PanelSection(props: {
  label: string;
  panels: () => PanelRef[];
  dropTarget: () => import("../layout/model.ts").MoveTarget;
  addTarget: import("../layout/model.ts").MoveTarget | undefined;
}): JSX.Element {
  const shell = useShell();
  let unregister: (() => void) | undefined;
  onCleanup(() => unregister?.());
  const tester: DropTester = (element, x, y) => {
    const rect = element.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    return props.dropTarget();
  };
  const register = (node: HTMLElement) => {
    unregister?.();
    unregister = shell.drag.register(node, tester);
  };
  return (
    <section class="nav-section" ref={register}>
      <p class="nav-label">{props.label}</p>
      <Show when={props.panels().length === 0}>
        <p class="nav-empty">Panelがありません</p>
      </Show>
      <For each={props.panels()}>
        {(panelRef) => <NavPanelRow panel={panelRef} />}
      </For>
      <button class="nav-add" onClick={() => shell.openPicker(props.addTarget)}>
        <IconPlus size={12} /> Pageを追加
      </button>
    </section>
  );
}

// パネル1行。clickで選択し、dragすれば領域移動になる。
// prop名はrefにしない — refはJSXの予約属性で、転送の対象になる。
function NavPanelRow(props: { panel: PanelRef }): JSX.Element {
  const shell = useShell();
  const ops = layoutOps(shell);
  const instance = () => shell.instance(props.panel);
  // そのpanelが自分の領域で選択中か。leafならfocusedLeaf側も見る。
  const selected = () => {
    const state = shell.layout();
    const location = locationOf(state, props.panel.instanceId);
    if (!location) return false;
    if (location.region === "dock") {
      return state[location.dock].selected === props.panel.instanceId;
    }
    const leaf = leafOf(state.center.root, props.panel.instanceId);
    return leaf?.selected === props.panel.instanceId;
  };

  const press = (event: PointerEvent) => {
    if (event.button !== 0) return;
    shell.drag.start(
      { instanceId: props.panel.instanceId, title: instance().title() },
      event,
      {
        onClick: () => {
          // dockのpanelならそのdockを開いてから選択する（畳まれていても見える）。
          const location = locationOf(shell.layout(), props.panel.instanceId);
          if (location?.region === "dock") {
            shell.updatePrefs((prefs) => {
              prefs.dockOpen = { ...prefs.dockOpen, [location.dock]: true };
            });
          }
          ops.select(props.panel.instanceId);
        },
      },
    );
  };

  return (
    <div
      class="nav-row"
      data-selected={selected() || undefined}
      {...surfaceAttrs(instance().activity(), "header")}
      {...busyAttr(instance().activity())}
      onPointerDown={press}
    >
      <span class="nav-title">{instance().title()}</span>
      <button
        class="tab-close"
        aria-label="閉じる"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          ops.close(props.panel.instanceId);
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  );
}

function ProjectTab(props: { name: string }): JSX.Element {
  const shell = useShell();
  const href = useHref(() => `/${shell.coreKey()}/${props.name}/`);
  return (
    <span class={{ "project-tab": true, selected: props.name === shell.project() }}>
      <a href={href()}>{props.name}</a>
      <ConfirmButton
        class="project-close"
        label="Projectを削除"
        confirmLabel="削除する？"
        confirm={() => void shell.removeProject(props.name)}
      >
        <IconClose size={10} />
      </ConfirmButton>
    </span>
  );
}

function AreaBranch(props: { areas: AreaTree[]; path: string[] }): JSX.Element {
  return (
    <ul class="area-list">
      <For each={props.areas}>
        {(area) => <AreaRow area={area} path={props.path} />}
      </For>
    </ul>
  );
}

function AreaRow(props: { area: AreaTree; path: string[] }): JSX.Element {
  const shell = useShell();
  const [addingChild, setAddingChild] = createSignal(false);
  const path = () => [...props.path, props.area.name];
  const href = useHref(() =>
    `/${shell.coreKey()}/${shell.project()}/${path().map(encodeURIComponent).join("/")}/`);
  const selected = () => shell.areaPath().join("/") === path().join("/");
  return (
    <li>
      <div class={{ "area-row": true, selected: selected() }}>
        <Show when={props.area.areas.length > 0}>
          <IconChevronRight size={10} />
        </Show>
        <a href={href()}>{props.area.name}</a>
        <button
          class="area-add-child"
          aria-label="子のAreaを作成"
          onClick={() => setAddingChild(true)}
        >
          <IconPlus size={10} />
        </button>
        <ConfirmButton
          class="area-remove"
          label="Areaを削除"
          confirmLabel="削除する？"
          confirm={() => void shell.removeArea(path())}
        >
          <IconClose size={10} />
        </ConfirmButton>
      </div>
      <Show when={addingChild()}>
        <NameForm
          label="子のArea名"
          submit={async (name) => {
            await shell.createArea(path(), name);
            setAddingChild(false);
          }}
          cancel={() => setAddingChild(false)}
        />
      </Show>
      <AreaBranch areas={props.area.areas} path={path()} />
    </li>
  );
}
