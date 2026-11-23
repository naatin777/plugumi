// Shellの状態を2段に分ける。ShellControllerはページ（URL・Core・Project・
// Area list・表示設定・panel picker）を持ち、AreaControllerは1つのAreaView
// が持つ状態（workspaceのlayout・Panel Instance・drag）を持つ。
// 同じAreaをMainとSubに同時に出した場合は別々のAreaControllerになり、
// 読み書きはlast-write-wins — プロトタイプの既知の制約。
import { placePopover, type PopoverAlign } from "./popover.ts";
import {
  createContext, createEffect, createMemo, createSignal, createStore,
  flush, onCleanup, reconcile, useContext,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { ShellHost, CoreEntry, PanelEntry, ProjectTree, AreaTree } from "../host.tsx";
import type { WorkspaceState, PanelRef, MoveTarget, DockKind } from "../layout/model.ts";
import {
  emptyWorkspace, addPanel, closePanel, selectPanel, movePanel,
  splitAt, setRatio,
  allPanelRefs,
  decodeWorkspace, newInstanceId,
} from "../layout/model.ts";
import type { AreaRef, AreaListState, AreaDisplay } from "../layout/area-list.ts";
import {
  areaKey, emptyAreaList, loadAreaList, pathFromKey, pathKey, saveAreaList,
} from "../layout/area-list.ts";
import { PanelInstance, resolvePanel } from "../panels/instance.ts";
import { builtinPanels } from "../panels/builtin.tsx";
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

  // Area list（左の列）。表示はProjectの全Areaから導出し、保存するのは
  // Subに移したAreaと表示形式の差分だけ（Projectごとの状態）。
  areaList(): AreaListState;
  applyAreaList(mutate: (state: AreaListState) => AreaListState): void;
  // Main/Subに表示するArea。MainはURLが正本。
  mainRef(): AreaRef | null;
  subRef(): AreaRef | null;
  displayOf(ref: AreaRef | null): AreaDisplay;
  // ページ送りなど「触っている側」のArea（.area-viewのpointerdownで更新）。
  focusedArea(): AreaController | null;
  setFocusedArea(area: AreaController): void;

  // Shellの横幅に応じた段階（ResizeObserverがセット）。
  // <1100pxでSubがdrawer、<800pxでArea listもdrawerになる。
  shellSize(): ShellSize;
  setShellSize(size: ShellSize): void;
  // drawer化した領域の一時的な開閉。prefsの開閉とは別signal — 狭くなった
  // 瞬間に保存済みの「開」がcenterを覆わないよう、初期は閉。
  subDrawer(): boolean;
  setSubDrawer(open: boolean): void;
  sideDrawer(): boolean;
  setSideDrawer(open: boolean): void;
  // drawerかどうかを含む実効の表示状態・切替。
  subDrawerMode(): boolean;
  sideDrawerMode(): boolean;
  subShown(): boolean;
  sideShown(): boolean;
  toggleSub(): void;
  toggleSide(): void;
  // 外pointerdownやEscapeで一時drawerを全部畳む。
  closeDrawers(): void;

  // 「+」のpanel pickerはshellに1個。開くとき対象のAreaControllerを指定する。
  pickerArea(): AreaController | null;
  pickerTarget(): MoveTarget | null;
  openPicker(area: AreaController, target?: MoveTarget,
    anchor?: HTMLElement, align?: PopoverAlign): void;
  bindPicker(element: HTMLElement): void;
  pickPanel(entry: PanelEntry): void;

  createProject(name: string): Promise<void>;
  removeProject(name: string): Promise<void>;
  createArea(project: string, parent: string[], name: string): Promise<void>;
  removeArea(project: string, path: string[]): Promise<void>;
}

export type ShellSize = "wide" | "medium" | "compact";
export type AreaSize = "wide" | "narrow" | "compact";

// 1つのAreaViewが持つ状態。layout・Panel Instance・dragは全部Area単位。
export interface AreaController {
  shell: ShellController;
  ref(): AreaRef | null;

  // AreaViewの実測幅に応じた段階（ResizeObserverがセット）。
  // narrowでleft/right、compactでbottomもdrawerになる。
  size(): AreaSize;
  setSize(size: AreaSize): void;
  // drawer化したdockの一時的な開閉（同時に開くのは1つ）。
  drawer(): DockKind | null;
  setDrawer(kind: DockKind | null): void;
  dockIsDrawer(kind: DockKind): boolean;
  // 実効の開閉（drawerならsignal、inlineならprefs）。
  dockShown(kind: DockKind): boolean;
  toggleDock(kind: DockKind): void;

  layout(): WorkspaceState;
  applyLayout(mutate: (state: WorkspaceState) => WorkspaceState): void;

  instance(ref: PanelRef): PanelInstance;
  openPanel(pluginId: string, panelId: string, target?: MoveTarget): void;

  drag: DragController;
  ghost(): { x: number; y: number; title: string } | null;
  dropElement(): HTMLElement | null;
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
  // 初回はmicrotaskへ逃がす — componentのsetup中に同期fetchすると、
  // fetcher内のreactive読み（coreKey等）がuntracked readとして警告される。
  queueMicrotask(() => void refresh());
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
  // 組み込みPanelはCoreに関係なく常に一覧の先頭に出る。
  const panels = () => [...builtinPanels, ...(panelsList() ?? [])];
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

  // ---- Area list ----
  const [areaListState, setAreaList] = createSignal<AreaListState>(emptyAreaList());
  const areaList = () => areaListState();
  const applyAreaList = (mutate: (state: AreaListState) => AreaListState) => {
    const next = mutate(areaListState());
    if (next === areaListState()) return;
    setAreaList(next);
    saveAreaList(coreKey(), project(), next);
  };

  // 選択中のAreaRef。MainはURLが正本、SubはselectedSubが正本。
  // 呼ぶたびに新しいobjectを返すとref()===currentの比較が常にfalseになるので、
  // areaKeyが同じなら同一参照（memoのequals）で返す。
  const sameArea = (a: AreaRef | null, b: AreaRef | null) =>
    (a ? areaKey(a) : null) === (b ? areaKey(b) : null);
  const mainRef = createMemo<AreaRef | null>(
    () => {
      const path = areaPath();
      if (path.length === 0) return null;
      return { project: project(), path };
    },
    { equals: (a, b) => sameArea(a, b) },
  );
  const subRef = createMemo<AreaRef | null>(
    () => {
      const key = areaListState().selectedSub;
      return key ? { project: project(), path: pathFromKey(key) } : null;
    },
    { equals: (a, b) => sameArea(a, b) },
  );
  // 表示形式はMain用だけ（Subはcenter固定でdisplayを持たない）。
  const displayOf = (ref: AreaRef | null): AreaDisplay =>
    ref ? areaListState().display[pathKey(ref.path)] ?? "full" : "full";

  // ---- 触っている側のArea ----
  const [focusedArea, setFocusedArea] = createSignal<AreaController | null>(null);

  // ---- 幅に応じたdrawer化 ----
  // drawerの開閉はsignal（prefsではない）— 狭くなった瞬間にcenterが
  // 覆われないよう初期は閉。AreaViewのdock drawerは各controllerが持つ。
  const [shellSize, setShellSize] = createSignal<ShellSize>("wide");
  const [subDrawer, setSubDrawer] = createSignal(false);
  const [sideDrawer, setSideDrawer] = createSignal(false);
  const subDrawerMode = () => shellSize() !== "wide";
  const sideDrawerMode = () => shellSize() === "compact";
  const subShown = () =>
    subDrawerMode() ? subDrawer() : prefs().subOpen;
  const sideShown = () =>
    sideDrawerMode() ? sideDrawer() : prefs().sidebarOpen;
  const toggleSub = () => {
    if (subDrawerMode()) setSubDrawer(!subDrawer());
    else updatePrefs((prefs) => { prefs.subOpen = !prefs.subOpen; });
  };
  const toggleSide = () => {
    if (sideDrawerMode()) setSideDrawer(!sideDrawer());
    else updatePrefs((prefs) => { prefs.sidebarOpen = !prefs.sidebarOpen; });
  };
  const closeDrawers = () => {
    setSubDrawer(false);
    setSideDrawer(false);
  };

  // ---- panel picker（shellに1個。開くとき対象のAreaControllerを取る） ----
  const [picker, setPicker] = createSignal<HTMLElement>();
  const [pickerArea, setPickerArea] = createSignal<AreaController | null>(null);
  const [pickerTarget, setPickerTarget] = createSignal<MoveTarget | null>(null);
  const openPicker = (area: AreaController, target?: MoveTarget,
    anchor?: HTMLElement, align?: PopoverAlign) => {
    setPickerArea(area);
    setPickerTarget(target ?? null);
    const el = picker();
    if (!el) return;
    el.showPopover();
    if (anchor) placePopover(el, anchor, align);
  };
  const pickPanel = (entry: PanelEntry) => {
    pickerArea()?.openPanel(entry.pluginId, entry.panelId, pickerTarget() ?? undefined);
  };

  // ---- project/area ----
  const createProject = async (name: string) => {
    await host.createProject(coreKey(), name);
    navigate(`/${coreKey()}/${name}/`);
  };
  const removeProject = async (name: string) => {
    await host.deleteProject(coreKey(), name);
    if (name === project()) navigate(`/${coreKey()}/`, { replace: true });
  };
  const createArea = async (projectName: string, parent: string[], name: string) => {
    await host.createArea(coreKey(), projectName, parent, name);
  };
  const removeArea = async (projectName: string, path: string[]) => {
    await host.deleteArea(coreKey(), projectName, path);
    // 開いていたArea（またはその祖先）を消したらprojectの入口へ戻す
    const current = areaPath();
    if (projectName === project() && path.every((part, index) => current[index] === part)) {
      navigate(`/${coreKey()}/${project()}/`, { replace: true });
    }
  };

  const controller: ShellController = {
    host, coreKey, project, areaPath, projectTree,
    cores, core, panels, projects,
    prefs, updatePrefs,
    areaList, applyAreaList,
    mainRef, subRef, displayOf,
    focusedArea, setFocusedArea,
    shellSize, setShellSize,
    subDrawer, setSubDrawer,
    sideDrawer, setSideDrawer,
    subDrawerMode, sideDrawerMode,
    subShown, sideShown,
    toggleSub, toggleSide, closeDrawers,
    pickerArea, pickerTarget, openPicker, bindPicker: setPicker, pickPanel,
    createProject, removeProject, createArea, removeArea,
  };

  // effectは2系統だけ: (a) core/project/areaの変化 → listの読み替え・
  // 場所記憶、(b) 何もしない。pollは同一内容を通知しないので巡回だけでは走らない。
  let loadedScope = "";
  createEffect(
    () => ({ core: coreKey(), project: project(), area: areaPath() }),
    ({ core, project, area }) => {
      // callbackはowned scope — signalへの書き込み（setAreaList）は
      // REACTIVE_WRITE_IN_OWNED_SCOPEになるのでmicrotaskへ。
      const scope = `${core}/${project}`;
      const firstLoad = scope !== loadedScope;
      loadedScope = scope;
      if (firstLoad) {
        queueMicrotask(() => setAreaList(loadAreaList(core, project)));
      }
      const path = area.length > 0
        ? `/${core}/${project}/${area.map(encodeURIComponent).join("/")}/`
        : `/${core}/${project}/`;
      saveLastLocation(core, path);
    },
  );

  return controller;
}

// AreaViewごとに1個作る。refが変わる（選択の切替）とworkspaceを読み直す。
export function createAreaController(
  shell: ShellController,
  ref: () => AreaRef | null,
): AreaController {
  const host = shell.host;

  // ---- 幅に応じたdrawer化（このAreaView単位） ----
  const [size, setSize] = createSignal<AreaSize>("wide");
  const [drawer, setDrawer] = createSignal<DockKind | null>(null);
  const dockIsDrawer = (kind: DockKind) =>
    size() === "compact" || (size() === "narrow" && kind !== "bottom");
  const dockShown = (kind: DockKind) =>
    dockIsDrawer(kind) ? drawer() === kind : shell.prefs().dockOpen[kind];
  const toggleDock = (kind: DockKind) => {
    if (dockIsDrawer(kind)) setDrawer(drawer() === kind ? null : kind);
    else shell.updatePrefs((prefs) => { prefs.dockOpen[kind] = !prefs.dockOpen[kind]; });
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

  let loadedKey = "";
  let saveTimer = 0;
  const scheduleSave = () => {
    // 発火時ではなく操作時点のAreaへ保存する（300ms以内の切替で隣へ書かない）
    const current = ref();
    if (!current) return;
    const key = shell.coreKey();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void host.putWorkspace(key, current.project, current.path, layoutState);
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
  const instance = (panelRef: PanelRef): PanelInstance => {
    let found = instances.get(panelRef.instanceId);
    if (!found) {
      const declaration = resolvePanel(panelRef, shell.panels());
      found = new PanelInstance(host, shell.coreKey(), panelRef,
        declaration?.title ?? panelRef.panelId, shell);
      instances.set(panelRef.instanceId, found);
      // instance()は描画中（spread・memo内）にも呼ばれる。mountのsignal書き込みを
      // その場で走らせるとowned scopeへの書き込みでREACTIVITY_HALTEDするので、
      // microtaskへ逃がす。
      const mounted = found;
      queueMicrotask(() => {
        if (declaration) void mounted.mount(declaration);
        else mounted.retry(shell.panels());
      });
    }
    return found;
  };
  // panels一覧・layoutの変化を追従し、layoutから外れたInstanceは捨てる
  // （effect本体は下部。reload/applyLayoutからも即時呼ぶ）。
  const syncInstances = () => {
    const list = shell.panels();
    for (const found of instances.values()) found.update(list);
    const alive = new Set(allPanelRefs(layoutState).map((panelRef) => panelRef.instanceId));
    for (const [id, found] of instances) {
      if (!alive.has(id)) {
        found.dispose();
        instances.delete(id);
      }
    }
  };

  // refが変わるたびworkspaceを読み直す。
  let loadingWorkspace = 0;
  const reload = async (current: AreaRef, core: string) => {
    // refは毎回新しいobjectを返し得るので、比較はareaKey同士で行う。
    const key = areaKey(current);
    if (key !== loadedKey) {
      const token = ++loadingWorkspace;
      const raw = await host.getWorkspace(core, current.project, current.path).catch(() => null);
      const live = ref();
      if (token === loadingWorkspace && live && areaKey(live) === key) {
        loadedKey = key;
        setLayout(decodeWorkspace(raw));
        flush();
        syncInstances();
      }
    }
  };

  const openPanel = (pluginId: string, panelId: string, target?: MoveTarget) => {
    const declaration = shell.panels().find(
      (entry) => entry.pluginId === pluginId && entry.panelId === panelId,
    );
    if (!declaration) return;
    const panelRef: PanelRef = { instanceId: newInstanceId(), pluginId, panelId };
    instance(panelRef); // mountを始めてからlayoutに入れる
    applyLayout((state) => addPanel(state, panelRef, target));
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

  onCleanup(() => {
    for (const found of instances.values()) found.dispose();
    instances.clear();
    window.clearTimeout(saveTimer);
  });

  const controller: AreaController = {
    shell, ref,
    size, setSize, drawer, setDrawer, dockIsDrawer, dockShown, toggleDock,
    layout, applyLayout,
    instance, openPanel,
    drag, ghost, dropElement,
  };

  // effectは2系統だけ: (a) refの変化 → 読み直し、(b) panels一覧の変化 →
  // Instance追従。
  createEffect(
    () => ({ current: ref(), core: shell.coreKey() }),
    ({ current, core }) => {
      if (current) void reload(current, core);
    },
  );
  // panels一覧とlayoutの両方をcomputeで読む — Instance追従はどちらの
  // 変化でも必要。storeの中身の読み出し（allPanelRefs）もcompute側でやる
  // — callbackはuntrackedなのでreactive読みはstrict警告になる。
  createEffect(
    // update()の中でもsignal(state)を読むので、callbackではなく
    // compute側で回す（書き込みはInstance内部のsignalだけ）。
    // panels一覧とlayoutの両方をdepに取る（update自体はcallback内のmicrotask）。
    () => {
      shell.panels();
      return allPanelRefs(layoutState).map((panelRef) => panelRef.instanceId);
    },
    (alive) => {
      // update/disposeはInstanceのsignalを書く — owned scope(effect)内では
      // 書けないのでmicrotaskへ逃がす。
      const keys = new Set(alive);
      queueMicrotask(() => {
        const list = shell.panels();
        for (const found of instances.values()) found.update(list);
        for (const [id, found] of instances) {
          if (!keys.has(id)) {
            found.dispose();
            instances.delete(id);
          }
        }
      });
    },
  );

  return controller;
}

export const ShellContext = createContext<ShellController>();

export function useShell(): ShellController {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("ShellContext の外で使われました");
  return shell;
}

export const AreaContext = createContext<AreaController>();

export function useArea(): AreaController {
  const area = useContext(AreaContext);
  if (!area) throw new Error("AreaContext の外で使われました");
  return area;
}

// leaf操作用の小さい操作群。UIから直接model関数へ橋渡しする。
export const layoutOps = (area: AreaController) => ({
  select: (instanceId: string) =>
    area.applyLayout((state) => selectPanel(state, instanceId)),
  close: (instanceId: string) =>
    area.applyLayout((state) => closePanel(state, instanceId)),
  split: (leafId: string, edge: "top" | "bottom" | "left" | "right") =>
    area.applyLayout((state) => splitAt(state, leafId, edge)),
  ratio: (splitId: string, ratio: number) =>
    area.applyLayout((state) => setRatio(state, splitId, ratio)),
});
