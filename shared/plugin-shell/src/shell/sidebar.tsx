// sidebar（Shell固有のナビ領域。Panelではない）= Area list。
// Main/Subの2セクションにAreaへの参照を並べる（SigmaOSの
// sidebarと同じ形）。行のclickでMainはURL切替、Subは選択する。
// 「＋ Areaを追加」はProject/Areaのツリーから選ぶpopover。
// prompt/confirmはElectronで使えないため、作成はinline入力、
// 削除は2段階のinline確認にする。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref, useNavigate } from "@solidjs/router";
import type { AreaTree } from "../host.tsx";
import type { AreaRef, AreaEntry, AreaDisplay, ListSlot } from "../layout/area-list.ts";
import { addArea, areaKey, moveArea, removeArea, selectArea, setDisplay } from "../layout/area-list.ts";
import { useShell } from "./controller.tsx";
import { NameForm, ConfirmButton } from "./inline.tsx";
import { Resizer } from "./resizer.tsx";
import { IconChevronRight, IconClose, IconPlus } from "../icons.tsx";

// popover内の項目を選んだら閉じる（選択後も残ると画面を覆う）。
const closePopover = (event: MouseEvent) => {
  const trigger = event.currentTarget as HTMLElement | null;
  trigger?.closest<HTMLElement>("[popover]")?.hidePopover();
};

const slotLabel = (ref: AreaRef): string =>
  ref.path[ref.path.length - 1] ?? ref.project;

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
        <AreaSlot slot="main" label="Main" />
        <AreaSlot slot="sub" label="Sub" />
      </nav>
    </>
  );
}

// 1セクション。行リスト＋「＋ Areaを追加」のpicker。
function AreaSlot(props: { slot: ListSlot; label: string }): JSX.Element {
  const shell = useShell();
  const entries = () => shell.areaList()[props.slot];
  return (
    <section class="area-slot">
      <p class="nav-label">{props.label}</p>
      <Show when={entries().length === 0}>
        <p class="nav-empty">Areaがありません</p>
      </Show>
      <For each={entries()}>
        {(entry) => <AreaRow slot={props.slot} entry={entry} />}
      </For>
      <AreaPicker slot={props.slot} />
    </section>
  );
}

const sameArea = (a: AreaRef | null, b: AreaRef | null) =>
  (a ? areaKey(a) : null) === (b ? areaKey(b) : null);

// Area1行。clickでMainはURL移動・Subは選択。
// prop名はrefにしない — refはJSXの予約属性で、転送の対象になる。
function AreaRow(props: { slot: ListSlot; entry: AreaEntry }): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  const key = () => areaKey(props.entry.area);
  const href = useHref(() =>
    `/${shell.coreKey()}/${props.entry.area.project}/` +
    `${props.entry.area.path.map(encodeURIComponent).join("/")}/`);
  // 強調は「そのAreaが実際にそのslotに出ているか」で決める。
  // MainはURL（mainRef）が正本 — listのselectedはURL同期の結果に過ぎない。
  const selected = () =>
    (props.slot === "main" && sameArea(shell.mainRef(), props.entry.area)) ||
    (props.slot === "sub" && sameArea(shell.subRef(), props.entry.area));
  const label = () =>
    props.entry.area.project === shell.project()
      ? slotLabel(props.entry.area)
      : `${props.entry.area.project} / ${slotLabel(props.entry.area)}`;

  const open = (event: MouseEvent) => {
    event.preventDefault();
    if (props.slot === "main") {
      navigate(`/${shell.coreKey()}/${props.entry.area.project}/` +
        `${props.entry.area.path.map(encodeURIComponent).join("/")}/`);
      return;
    }
    if (props.slot === "sub") {
      shell.applyAreaList((state) => selectArea(state, "sub", key()));
      shell.updatePrefs((prefs) => { prefs.subOpen = true; });
      return;
    }
  };

  const move = (to: ListSlot) => (event: MouseEvent) => {
    closePopover(event);
    shell.applyAreaList((state) => moveArea(state, props.slot, key(), to));
    if (to === "main") {
      navigate(`/${shell.coreKey()}/${props.entry.area.project}/` +
        `${props.entry.area.path.map(encodeURIComponent).join("/")}/`);
    }
    if (to === "sub") shell.updatePrefs((prefs) => { prefs.subOpen = true; });
  };

  const setMode = (display: AreaDisplay) => (event: MouseEvent) => {
    closePopover(event);
    shell.applyAreaList((state) => setDisplay(state, props.slot, key(), display));
  };

  const remove = (event: MouseEvent) => {
    closePopover(event);
    // URLが指しているAreaを外すとdeep linkで即座に戻るので、先に入口へ戻す。
    const current = shell.mainRef();
    if (props.slot === "main" && current && areaKey(current) === key()) {
      navigate(`/${shell.coreKey()}/${shell.project()}/`);
    }
    shell.applyAreaList((state) => removeArea(state, props.slot, key()));
  };

  let menu!: HTMLDivElement;
  const otherSlots = (
    [
      { to: "main", label: "Mainへ" },
      { to: "sub", label: "Subへ" },
    ] as { to: ListSlot; label: string }[]
  ).filter((item) => item.to !== props.slot);

  return (
    <div class={{ "area-row": true, selected: selected() }}>
      <a href={href()} onClick={open}>{label()}</a>
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
        <For each={otherSlots}>
          {(item) => (
            <button class="area-menu-item" onClick={move(item.to)}>{item.label}</button>
          )}
        </For>
        <p class="area-menu-label">表示</p>
        <button
          class={{ "area-menu-item": true, selected: props.entry.display === "full" }}
          onClick={setMode("full")}
        >
          すべて
        </button>
        <button
          class={{ "area-menu-item": true, selected: props.entry.display === "center" }}
          onClick={setMode("center")}
        >
          centerのみ
        </button>
        <button class="area-menu-item danger" onClick={remove}>リストから外す</button>
      </div>
    </div>
  );
}

// 「＋ Areaを追加」。Project/AreaのツリーからAreaを選ぶpopover。
// Area・Projectの作成もここで行う。
function AreaPicker(props: { slot: ListSlot }): JSX.Element {
  const shell = useShell();
  const navigate = useNavigate();
  const [browse, setBrowse] = createSignal<string | null>(null);
  const project = () => browse() ?? shell.project() ?? shell.projects()[0]?.name ?? "";
  const tree = () => shell.projects().find((item) => item.name === project());
  const [addingProject, setAddingProject] = createSignal(false);
  let picker!: HTMLDivElement;

  const pick = (ref: AreaRef) => (event: MouseEvent) => {
    closePopover(event);
    shell.applyAreaList((state) => addArea(state, props.slot, ref));
    if (props.slot === "main") {
      navigate(`/${shell.coreKey()}/${ref.project}/` +
        `${ref.path.map(encodeURIComponent).join("/")}/`);
    }
    if (props.slot === "sub") shell.updatePrefs((prefs) => { prefs.subOpen = true; });
  };

  return (
    <>
      <button
        class="area-add"
        onClick={() => {
          setBrowse(null);
          picker.showPopover();
        }}
      >
        <IconPlus size={12} /> Areaを追加
      </button>
      <div class="area-picker" popover="auto" ref={picker}>
        <div class="project-tabs">
          <For each={shell.projects()}>
            {(item) => (
              <button
                class={{ "project-tab": true, selected: item.name === project() }}
                onClick={() => setBrowse(item.name)}
              >
                {item.name}
              </button>
            )}
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
        <Show when={tree()} fallback={<p class="area-hint">Project を作成してください</p>}>
          <PickBranch areas={tree()!.areas} path={[]} project={project} pick={pick} />
        </Show>
      </div>
    </>
  );
}

// picker内のAreaツリー。名前のclickが選択（slotへ追加）になる。
function PickBranch(props: {
  areas: AreaTree[];
  path: string[];
  project: () => string;
  pick: (ref: AreaRef) => (event: MouseEvent) => void;
}): JSX.Element {
  return (
    <ul class="area-list">
      <For each={props.areas}>
        {(area) => (
          <PickRow area={area} path={props.path} project={props.project} pick={props.pick} />
        )}
      </For>
      <Show when={props.areas.length === 0 && props.path.length === 0}>
        <PickRootAdd project={props.project} />
      </Show>
    </ul>
  );
}

// ツリー最下段の「＋ Areaを追加」（rootのAreaを作る）。
function PickRootAdd(props: { project: () => string }): JSX.Element {
  const shell = useShell();
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
          await shell.createArea(props.project(), [], name);
          setAdding(false);
        }}
        cancel={() => setAdding(false)}
      />
    </Show>
  );
}

function PickRow(props: {
  area: AreaTree;
  path: string[];
  project: () => string;
  pick: (ref: AreaRef) => (event: MouseEvent) => void;
}): JSX.Element {
  const shell = useShell();
  const [addingChild, setAddingChild] = createSignal(false);
  const path = () => [...props.path, props.area.name];
  return (
    <li>
      <div class="area-row">
        <Show when={props.area.areas.length > 0}>
          <IconChevronRight size={10} />
        </Show>
        <a
          href="#"
          onClick={(event) =>
            props.pick({ project: props.project(), path: path() })(event)}
        >
          {props.area.name}
        </a>
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
          confirm={() => void shell.removeArea(props.project(), path())}
        >
          <IconClose size={10} />
        </ConfirmButton>
      </div>
      <Show when={addingChild()}>
        <NameForm
          label="子のArea名"
          submit={async (name) => {
            await shell.createArea(props.project(), path(), name);
            setAddingChild(false);
          }}
          cancel={() => setAddingChild(false)}
        />
      </Show>
      <PickBranch
        areas={props.area.areas}
        path={path()}
        project={props.project}
        pick={props.pick}
      />
    </li>
  );
}
