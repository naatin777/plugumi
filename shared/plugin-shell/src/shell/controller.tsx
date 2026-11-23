// 1つのProject画面（Area移動を含む）が持つ状態の束。
// routeのparams・保存・Panel Instance・表示設定・dragをここにまとめ、
// 見た目だけの部品にはcontext経由で渡す。
import {
  createContext, createEffect, createSignal, createStore, flush,
  onCleanup, reconcile, useContext,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { ShellHost, CoreEntry, PanelEntry, ProjectTree, AreaTree } from "../host.tsx";
import type { WorkspaceState, PanelRef, MoveTarget } from "../layout/model.ts";
import {
  emptyWorkspace, addPanel, closePanel, selectPanel, movePanel,
  splitAt, setRatio,
  allPanelRefs,
  decodeWorkspace, newInstanceId,
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

  layout(): WorkspaceState;
  applyLayout(mutate: (state: WorkspaceState) => WorkspaceState): void;

  instance(ref: PanelRef): PanelInstance;
  openPanel(pluginId: string, panelId: string, target?: MoveTarget): void;

  // 「+」のpanel picker。空leafの「+」やnavのSide追加も同じpickerを開き、
  // 足し先をMoveTargetで指定する（未指定はfocusedLeaf）。
  pickerTarget(): MoveTarget | null;
  openPicker(target?: MoveTarget): void;
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

// store reconcileのキー。並びの中身は leaf/split(id) か PanelRef(instanceId)
// のどれかなので、全部を1つの関数で見る。
const layoutKey = (item: { id?: string; instanceId?: string }): string | undefined =>
  item.id ?? item.instanceId;

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

  // ---- layout（workspaceを1つの状態に持つ） ----
  // store+reconcileで、変わらないleaf/PanelRefのproxyを保つ。
  // 全体を置き換えるとtabやPanel hostが毎回作り直され、Panel内の
  // scroll位置や読み込み状態が消える。
  const [layoutState, writeLayout] = createStore<WorkspaceState>(emptyWorkspace());
  const layout = () => layoutState;
  const setLayout = (next: WorkspaceState) => {
    writeLayout(reconcile(next, layoutKey) as (state: WorkspaceState) => WorkspaceState);
  };

  let loadedArea = "";
  let saveTimer = 0;
  const scheduleSave = () => {
    // 発火時ではなく操作時点のAreaへ保存する（300ms以内の切替で隣へ書かない）
    const area = [...areaPath()];
    const key = coreKey();
    const proj = project();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void host.putWorkspace(key, proj, area, layoutState);
    }, 300);
  };

  const applyLayout = (mutate: (state: WorkspaceState) => WorkspaceState) => {
    const next = mutate(layoutState);
    if (next === layoutState) return;
    setLayout(next);
    scheduleSave();
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

  // areaが変わるたびworkspaceを読み直す。
  let loadingWorkspace = 0;
  const reload = async () => {
    const area = areaPath().join("/");
    if (area !== loadedArea) {
      const token = ++loadingWorkspace;
      const raw = await host.getWorkspace(coreKey(), project(), areaPath()).catch(() => null);
      if (token === loadingWorkspace) {
        loadedArea = area;
        setLayout(decodeWorkspace(raw));
        flush();
        syncInstances();
      }
    }
  };

  const openPanel = (pluginId: string, panelId: string, target?: MoveTarget) => {
    const declaration = panels().find(
      (entry) => entry.pluginId === pluginId && entry.panelId === panelId,
    );
    if (!declaration) return;
    const ref: PanelRef = { instanceId: newInstanceId(), pluginId, panelId };
    instance(ref); // mountを始めてからlayoutに入れる
    applyLayout((state) => addPanel(state, ref, target));
  };

  // ---- panel picker（「+」はtitle・空leaf・navの追加のどれからでも開く） ----
  const [picker, setPicker] = createSignal<HTMLElement>();
  const [pickerTarget, setPickerTarget] = createSignal<MoveTarget | null>(null);
  const openPicker = (target?: MoveTarget) => {
    setPickerTarget(target ?? null);
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
    window.clearTimeout(saveTimer);
  });

  const controller: ShellController = {
    host, coreKey, project, areaPath, projectTree,
    cores, core, panels, projects,
    prefs, updatePrefs,
    layout, applyLayout,
    instance, openPanel,
    pickerTarget, openPicker, bindPicker: setPicker,
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
