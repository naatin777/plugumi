// sidebar（Shell固有のナビ領域。Panelではない）。
// Space=Projectを札で切替え、選択中のProjectのAreaツリーを見せる。
// Areaを選ぶとURLが変わり、Workspaceが入れ替わる。
// prompt/confirmはElectronで使えないため、作成はinline入力、
// 削除は2段階のinline確認にする。
import { For, Show, createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";
import { useHref } from "@solidjs/router";
import type { AreaTree } from "../host.tsx";
import { useShell } from "./controller.tsx";
import { NameForm, ConfirmButton } from "./inline.tsx";
import { IconChevronRight, IconClose, IconPlus } from "../icons.tsx";

export function SidebarView(): JSX.Element {
  const shell = useShell();
  const [addingProject, setAddingProject] = createSignal(false);
  const [addingArea, setAddingArea] = createSignal(false);
  return (
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
    </nav>
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
