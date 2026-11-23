// 1つのProject画面（Area移動を含む）が持つ状態の束。
// routeのparams・保存・Panel Instance・表示設定・dragをここにまとめ、
// 見た目だけの部品にはcontext経由で渡す。
import { createContext, useContext } from "solid-js";
import {
  createEffect, createSignal, createStore, flush, onCleanup, reconcile, snapshot,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { ShellHost, CoreEntry, PanelEntry, ProjectTree, AreaTree } from "../host.tsx";
import type { LayoutState, PanelRef, MoveTarget } from "../layout/model.ts";
import {
  emptyLayout, addPanel, closePanel, selectPanel, movePanel,
  splitAt, setRatio,
  allPanelRefs,
  decodePinned, decodeWorkspace, newInstanceId,
} from "../layout/model.ts";
import { PanelInstance, resolvePanel } from "../panels/instance.ts";
import { loadPrefs, savePrefs, type ShellPrefs } from "../prefs.ts";
import { applyTheme } from "../theme.ts";
import { saveLastLocation } from "../storage.ts";
import { createDragController, type DragController } from "./drag.ts";

export function areaPathOf(segment: string | undefined): string[] {
  if (!segment) return [];
  return segment.split("/").filter(Boolean).map(decodeURIComponent);
}

export function findArea(areas: AreaTree[], path: string[]): AreaTree | undefined {
  if (path.length === 0) return { name: "", areas };
  let nodes = areas;
  let found: AreaTree | undefined;
  for (const name of path) {
    found = nodes.find((area) => area.name === name);
    if (!found) return undefined;
    nodes = found.areas;
  }
  return found;
}

export interface ShellController {
  host: ShellHost;
  coreKey(): string;
  project(): string;
  areaPath(): string[];
  projectTree(): ProjectTree | undefined;

  cores(): CoreEntry[];
  core(): CoreEntry | undefined;
  panels(): PanelEntry[];
  projects(): ProjectTree[];

  prefs(): ShellPrefs;
  updatePrefs(mutate: (prefs: ShellPrefs) => void): void;

  layout(): LayoutState;
  // 1回の操作でworkspaceとpinnedを同時に触れるよう、状態は1つに持つ。
  applyLayout(mutate: (state: LayoutState) => LayoutState): void;

  instance(ref: PanelRef): PanelInstance;
  openPanel(pluginId: string, panelId: string, leafId?: string): void;

  // 「+」のpanel picker。空leafの「+」も同じpickerを開き、足し先を指定する。
  pickerLeaf(): string | null;
  openPicker(leafId?: string): void;
  bindPicker(element: HTMLElement): void;

  drag: DragController;
  ghost(): { x: number; y: number; title: string } | null;
  dropElement(): HTMLElement | null;

  createProject(name: string): Promise<void>;
  removeProject(name: string): Promise<void>;
  createArea(parent: string[], name: string): Promise<void>;
  removeArea(path: string[]): Promise<void>;
}

// 3秒ごとの巡回用。fetcherの結果をsignalに入れる。中身が変わらなければ
// 通知しない（巡回のたびに読み直しeffectが走るのを防ぐ）。
function poll<T>(fetcher: () => Promise<T>, ms: number): () => T | undefined {
  const [value, setValue] = createSignal<T | undefined>(undefined, {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const refresh = async () => {
    try {
      const next = await fetcher();
      setValue(next as Exclude<T, Function>);
    } catch {
      // 巡回の失敗はstatus表示に任せ、ここでは握る
    }
  };
  void refresh();
  const timer = setInterval(refresh, ms);
  onCleanup(() => clearInterval(timer));
  return value;
}

// store reconcileのキー。並びの中身は leaf/split(id)・PanelRef(instanceId)・
// pinned(panelsはinstanceId) のどれかなので、全部を1つの関数で見る。
const layoutKey = (item: {
  id?: string;
  instanceId?: string;
  panel?: { instanceId?: string };
}): string | undefined => item.id ?? item.instanceId ?? item.panel?.instanceId;

export function createShellController(
  host: ShellHost,
  params: () => { core?: string; project?: string; areaPath?: string },
): ShellController {
  const navigate = useNavigate();
  const coreKey = () => params().core ?? "";
  const project = () => params().project ?? "";
  const areaPath = () => areaPathOf(params().areaPath);

  const coresList = poll(() => host.listCores(), 3000);
  const panelsList = poll(() => host.listPanels(coreKey()), 3000);
  const projectsList = poll(() => host.listProjects(coreKey()), 3000);
  const cores = () => coresList() ?? [];
  const panels = () => panelsList() ?? [];
  const projects = () => projectsList() ?? [];
  const core = () => coresList()?.find((entry) => entry.key === coreKey());
  const projectTree = () => projectsList()?.find((tree) => tree.name === project());

  // ---- 表示設定 ----
  const [prefs, setPrefs] = createSignal<ShellPrefs>(loadPrefs());
  const updatePrefs = (mutate: (prefs: ShellPrefs) => void) => {
    const next = { ...prefs() };
    mutate(next);
    setPrefs(next);
    savePrefs(next);
    applyTheme(next.theme);
  };

  // ---- layout（workspace + pinnedを1つの状態に持つ） ----
  // store+reconcileで、変わらないleaf/PanelRefのproxyを保つ。
  // 全体を置き換えるとtabやPanel hostが毎回作り直され、Panel内の
  // scroll位置や読み込み状態が消える。
  const [layoutState, writeLayout] = createStore<LayoutState>(emptyLayout());
  const layout = () => layoutState;
  const setLayout = (next: LayoutState) => {
    writeLayout(reconcile(next, layoutKey) as (state: LayoutState) => LayoutState);
  };

  let loadedArea = "";
  const saveTimers = { workspace: 0, pinned: 0 };
  const scheduleSave = (what: "workspace" | "pinned") => {
    // 発火時ではなく操作時点のAreaへ保存する（300ms以内の切替で隣へ書かない）
    const area = [...areaPath()];
    const key = coreKey();
    const proj = project();
    window.clearTimeout(saveTimers[what]);
    saveTimers[what] = window.setTimeout(() => {
      if (what === "workspace") {
        void host.putWorkspace(key, proj, area, layoutState.workspace);
      } else {
        void host.putPinned(key, proj, layoutState.pinned);
      }
    }, 300);
  };

  const applyLayout = (mutate: (state: LayoutState) => LayoutState) => {
    const next = mutate(layoutState);
    if (next === layoutState) return;
    // 操作は小さいので、変わった側だけ文字列比較で保存対象を決める。
    const workspaceChanged =
      JSON.stringify(next.workspace) !== JSON.stringify(layoutState.workspace);
    const pinnedChanged =
      JSON.stringify(next.pinned) !== JSON.stringify(layoutState.pinned);
    setLayout(next);
    if (workspaceChanged) scheduleSave("workspace");
    if (pinnedChanged) scheduleSave("pinned");
    flush();
    syncInstances();
  };

  // ---- Panel Instance ----
  const instances = new Map<string, PanelInstance>();
  const instance = (ref: PanelRef): PanelInstance => {
    let found = instances.get(ref.instanceId);
    if (!found) {
      const declaration = resolvePanel(ref, panels());
      found = new PanelInstance(host, coreKey(), ref, declaration?.title ?? ref.panelId);
      instances.set(ref.instanceId, found);
      if (declaration) void found.mount(declaration);
      else found.retry(panels());
    }
    return found;
  };
  // panels一覧の変化を追従し、layoutから外れたInstanceは捨てる。
  const syncInstances = () => {
    const list = panels();
    for (const found of instances.values()) found.update(list);
    const alive = new Set(allPanelRefs(layoutState).map((ref) => ref.instanceId));
    for (const [id, found] of instances) {
      if (!alive.has(id)) {
        found.dispose();
        instances.delete(id);
      }
    }
  };

  // areaが変わるたびworkspaceを読み直す。pinnedはprojectごとに1回。
  let loadedProject = "";
  // pinnedとworkspaceは別系統で読む。同じtokenで潰し合うと、次のeffect runが
  // 先のfetch結果を捨ててpinnedが一度も載らない。
  let loadingPinned = 0;
  let loadingWorkspace = 0;
  const reload = async () => {
    const area = areaPath().join("/");
    if (project() !== loadedProject) {
      loadedProject = project();
      loadedArea = "";
      const token = ++loadingPinned;
      const raw = await host.getPinned(coreKey(), project()).catch(() => null);
      if (token === loadingPinned) {
        setLayout({ workspace: snapshot(layoutState.workspace), pinned: decodePinned(raw) });
        flush();
        syncInstances();
      }
    }
    if (area !== loadedArea) {
      const token = ++loadingWorkspace;
      const raw = await host.getWorkspace(coreKey(), project(), areaPath()).catch(() => null);
      if (token === loadingWorkspace) {
        loadedArea = area;
        setLayout({ workspace: decodeWorkspace(raw), pinned: snapshot(layoutState.pinned) });
        flush();
        syncInstances();
      }
    }
  };

  const openPanel = (pluginId: string, panelId: string, leafId?: string) => {
    const declaration = panels().find(
      (entry) => entry.pluginId === pluginId && entry.panelId === panelId,
    );
    if (!declaration) return;
    const ref: PanelRef = { instanceId: newInstanceId(), pluginId, panelId };
    instance(ref); // mountを始めてからlayoutに入れる
    const target: MoveTarget | undefined = leafId
      ? { region: "leaf", leafId, index: -1 }
      : undefined;
    applyLayout((state) => addPanel(state, ref, target));
  };

  // ---- panel picker（「+」はtitleと空leafの両方から開く） ----
  const [picker, setPicker] = createSignal<HTMLElement>();
  const [pickerLeaf, setPickerLeaf] = createSignal<string | null>(null);
  const openPicker = (leafId?: string) => {
    setPickerLeaf(leafId ?? null);
    picker()?.showPopover();
  };

  // ---- drag & drop ----
  const [ghost, setGhost] = createSignal<{ x: number; y: number; title: string } | null>(null);
  const [dropElement, setDropElementRaw] = createSignal<HTMLElement | null>(null);
  let marked: HTMLElement | null = null;
  const setDropElement = (element: HTMLElement | null) => {
    marked?.removeAttribute("data-drop-target");
    marked = element;
    marked?.setAttribute("data-drop-target", "");
    setDropElementRaw(element);
  };
  const drag = createDragController(setGhost, setDropElement, (instanceId, target) => {
    applyLayout((state) => movePanel(state, instanceId, target));
  });

  // ---- project/area ----
  const createProject = async (name: string) => {
    await host.createProject(coreKey(), name);
    navigate(`/${coreKey()}/${name}/`);
  };
  const removeProject = async (name: string) => {
    await host.deleteProject(coreKey(), name);
    if (name === project()) navigate(`/${coreKey()}/`, { replace: true });
  };
  const createArea = async (parent: string[], name: string) => {
    await host.createArea(coreKey(), project(), parent, name);
  };
  const removeArea = async (path: string[]) => {
    await host.deleteArea(coreKey(), project(), path);
    // 開いていたArea（またはその祖先）を消したらprojectの入口へ戻す
    const current = areaPath();
    if (path.every((part, index) => current[index] === part)) {
      navigate(`/${coreKey()}/${project()}/`, { replace: true });
    }
  };

  onCleanup(() => {
    for (const found of instances.values()) found.dispose();
    instances.clear();
    window.clearTimeout(saveTimers.workspace);
    window.clearTimeout(saveTimers.pinned);
  });

  const controller: ShellController = {
    host, coreKey, project, areaPath, projectTree,
    cores, core, panels, projects,
    prefs, updatePrefs,
    layout, applyLayout,
    instance, openPanel,
    pickerLeaf, openPicker, bindPicker: setPicker,
    drag, ghost, dropElement,
    createProject, removeProject, createArea, removeArea,
  };

  // effectは2系統だけ: (a) project/areaの変化 → 読み直し + 端末の場所記憶、
  // (b) panels一覧の変化 → Instance追従。pollは同一内容を通知しないので
  // 巡回だけでは走らない。
  createEffect(
    () => ({ project: project(), area: areaPath().join("/") }),
    ({ project, area }) => {
      void reload();
      const path = area
        ? `/${coreKey()}/${project}/${area}/`
        : `/${coreKey()}/${project}/`;
      saveLastLocation(coreKey(), path);
    },
  );
  createEffect(
    () => panels(),
    () => syncInstances(),
  );

  return controller;
}

export const ShellContext = createContext<ShellController>();

export function useShell(): ShellController {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("ShellContext の外で使われました");
  return shell;
}

// leaf操作用の小さい操作群。UIから直接model関数へ橋渡しする。
export const layoutOps = (shell: ShellController) => ({
  select: (instanceId: string) =>
    shell.applyLayout((state) => selectPanel(state, instanceId)),
  close: (instanceId: string) =>
    shell.applyLayout((state) => closePanel(state, instanceId)),
  split: (leafId: string, edge: "top" | "bottom" | "left" | "right") =>
    shell.applyLayout((state) => splitAt(state, leafId, edge)),
  ratio: (splitId: string, ratio: number) =>
    shell.applyLayout((state) => setRatio(state, splitId, ratio)),
});
