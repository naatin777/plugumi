// Shellの状態を2段に分ける。ShellControllerはページ（URL・Core・Project・
// Area list・表示設定・panel picker）を持ち、AreaControllerは1つのAreaView
// が持つ状態（workspaceのlayout・Panel Instance・drag）を持つ。
// 同じAreaをMainとSubに同時に出した場合は別々のAreaControllerになり、
// 読み書きはlast-write-wins — プロトタイプの既知の制約。
import { placePopover, type PopoverAlign } from "./popover.ts";
import {
  createContext, createEffect, createMemo, createSignal, createStore,
  flush, onCleanup, reconcile, untrack, useContext,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { ShellHost, CoreEntry, PanelEntry, ProjectTree, AreaTree } from "../host.tsx";
import type { WorkspaceState, PanelRef, MoveTarget } from "../layout/model.ts";
import {
  emptyWorkspace, addPanel, closePanel, selectPanel, movePanel, detachPanel,
  splitAt, setRatio,
  allPanelRefs, leafOf,
  decodeWorkspace, newInstanceId,
} from "../layout/model.ts";
import type { AreaRef, AreaListState } from "../layout/area-list.ts";
import {
  areaKey, emptyAreaList, loadAreaList, pathFromKey, saveAreaList,
} from "../layout/area-list.ts";
import { PanelInstance, resolvePanel } from "../panels/instance.ts";
import { builtinPanels } from "../panels/builtin.ts";
import { loadPrefs, savePrefs, type ShellPrefs } from "../prefs.ts";
import { applyTheme } from "../theme.ts";
import { saveLastLocation } from "../storage.ts";
import { createDragController, type DragController } from "./drag.ts";

export function areaPathOf(segment: string | undefined): string[] {
  if (!segment) return [];
  return segment.split("/").filter(Boolean).map(decodeURIComponent);
}

export function findArea(areas: AreaTree[], path: string[]): AreaTree | undefined {
  if (path.length === 0) return { key: "", title: "", areas };
  let nodes = areas;
  let found: AreaTree | undefined;
  for (const key of path) {
    found = nodes.find((area) => area.key === key);
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
  // ページ送りなど「触っている側」のArea（[data-part="area-view"]のpointerdownで更新）。
  focusedArea(): AreaController | null;
  setFocusedArea(area: AreaController): void;

  // ---- drag & drop（windowに1個。全AreaControllerが共有する） ----
  drag: DragController;
  ghost(): { x: number; y: number; title: string } | null;

  // Shellの横幅に応じた段階（ResizeObserverがセット）。
  // <1100pxでSubがdrawer、<800pxでArea listもdrawerになる。
  shellSize(): ShellSize;
  setShellSize(size: ShellSize): void;
  // drawer化した領域の一時的な開閉。prefsの開閉とは別signal — 狭くなった
  // 瞬間に保存済みの「開」がcenterを覆わないよう、初期は閉。
  subDrawer(): boolean;
  sideDrawer(): boolean;
  // drawerかどうかを含む実効の表示状態・切替。
  subDrawerMode(): boolean;
  sideDrawerMode(): boolean;
  subShown(): boolean;
  sideShown(): boolean;
  toggleSub(): void;
  toggleSide(): void;
  // 外pointerdownやEscapeで一時drawerを全部畳む。drawerはshell全体で
  // 1つしか開かない（開く側のtoggleが先にこれを呼ぶ）。
  closeDrawers(): void;

  // 「+」のpanel pickerはshellに1個。開くとき対象のAreaControllerを指定する。
  openPicker(area: AreaController, target?: MoveTarget,
    anchor?: HTMLElement, align?: PopoverAlign): void;
  bindPicker(element: HTMLElement): void;
  pickPanel(entry: PanelEntry): void;

  // 作成はtitleを渡す。返るのはserverが発行したkey（URLに使う）。
  createProject(title: string): Promise<void>;
  createArea(project: string, parent: string[], title: string): Promise<string>;
  removeArea(project: string, path: string[]): Promise<void>;
}

export type ShellSize = "wide" | "medium" | "compact";

// 1つのAreaViewが持つ状態。layout・Panel Instance・dragは全部Area単位。
export interface AreaController {
  shell: ShellController;
  ref(): AreaRef | null;

  layout(): WorkspaceState;
  applyLayout(mutate: (state: WorkspaceState) => WorkspaceState): void;

  instance(ref: PanelRef, input?: unknown): PanelInstance;
  openPanel(providerId: string, panelId: string, target?: MoveTarget, input?: unknown): void;
  // 別AreaControllerへ移す: 元からPanelRefを取り出し（disposeしない）、
  // 先へInstanceごと入れる。移すと両方のlayoutがそれぞれ保存される。
  detach(instanceId: string): { instance: PanelInstance; ref: PanelRef } | null;
  adopt(instance: PanelInstance, ref: PanelRef, target: MoveTarget): void;

  // drag controllerはshellが持つ1個を共有する。
  drag: DragController;
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
  const projectTree = () => projectsList()?.find((tree) => tree.key === project());

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
  // ---- 触っている側のArea ----
  const [focusedArea, setFocusedArea] = createSignal<AreaController | null>(null);

  // ---- 幅に応じたdrawer化 ----
  // drawerの開閉はsignal（prefsではない）— 狭くなった瞬間にcenterが
  // 覆われないよう初期は閉。開くdrawerはshell全体で1つ — 新しく開くと
  // 他は全部畳まれる（台が重ならないため）。
  const closeDrawers = () => {
    setSubDrawer(false);
    setSideDrawer(false);
  };
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
    if (subDrawerMode()) {
      const next = !subDrawer();
      closeDrawers();
      setSubDrawer(next);
    } else updatePrefs((prefs) => { prefs.subOpen = !prefs.subOpen; });
  };
  const toggleSide = () => {
    if (sideDrawerMode()) {
      const next = !sideDrawer();
      closeDrawers();
      setSideDrawer(next);
    } else updatePrefs((prefs) => { prefs.sidebarOpen = !prefs.sidebarOpen; });
  };

  // ---- drag & drop（windowに1個。AreaControllerが共有する） ----
  const [ghost, setGhost] = createSignal<{ x: number; y: number; title: string } | null>(null);
  let marked: HTMLElement | null = null;
  const setDropElement = (element: HTMLElement | null) => {
    marked?.removeAttribute("data-drop-target");
    marked = element;
    marked?.setAttribute("data-drop-target", "");
  };
  const drag = createDragController(setGhost, setDropElement, (session, target, targetArea) => {
    if (targetArea === session.area) {
      targetArea.applyLayout((state) => movePanel(state, session.instanceId, target));
      return;
    }
    // 別のAreaControllerへはInstanceを作り直さず移す。
    const detached = session.area.detach(session.instanceId);
    if (!detached) return;
    targetArea.adopt(detached.instance, detached.ref, target);
  });

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
    pickerArea()?.openPanel(entry.providerId, entry.panelId, pickerTarget() ?? undefined);
  };

  // ---- project/area ----
  const createProject = async (title: string) => {
    const key = await host.createProject(coreKey(), title);
    navigate(`/${coreKey()}/${key}/`);
  };
  // 発行されたkeyを返す — 作成直後の遷移・配置はkeyが必要。
  const createArea = async (projectKey: string, parent: string[], title: string) => {
    return host.createArea(coreKey(), projectKey, parent, title);
  };
  const removeArea = async (projectKey: string, path: string[]) => {
    await host.deleteArea(coreKey(), projectKey, path);
    // 開いていたArea（またはその祖先）を消したらprojectの入口へ戻す
    const current = areaPath();
    if (projectKey === project() && path.every((part, index) => current[index] === part)) {
      navigate(`/${coreKey()}/${project()}/`, { replace: true });
    }
  };

  const controller: ShellController = {
    host, coreKey, project, areaPath, projectTree,
    cores, core, panels, projects,
    prefs, updatePrefs,
    areaList, applyAreaList,
    mainRef, subRef,
    focusedArea, setFocusedArea,
    drag, ghost,
    shellSize, setShellSize,
    subDrawer,
    sideDrawer,
    subDrawerMode, sideDrawerMode,
    subShown, sideShown,
    toggleSub, toggleSide, closeDrawers,
    openPicker, bindPicker: setPicker, pickPanel,
    createProject, createArea, removeArea,
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
  const instance = (panelRef: PanelRef, input?: unknown): PanelInstance => {
    let found = instances.get(panelRef.instanceId);
    if (!found) {
      const declaration = resolvePanel(panelRef, shell.panels());
      found = new PanelInstance(host, shell.coreKey(), panelRef,
        declaration?.title ?? panelRef.panelId, shell,
        declaration?.kind ?? "plugin");
      found.input = input;
      // context.openPanel — 呼び出し時点のlayoutから自分が居るleafを
      // 探して、隣に同じPluginの別Panelを足す。leafから外れていれば無視。
      const source = found;
      found.openSibling = (panelId, next) => {
        const leaf = leafOf(layoutState.center.root, source.id);
        if (!leaf) return;
        const index = leaf.panels.findIndex((ref) => ref.instanceId === source.id);
        openPanel(source.providerId, panelId,
          { region: "leaf", leafId: leaf.id, index: index + 1 }, next);
      };
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

  const openPanel = (providerId: string, panelId: string, target?: MoveTarget, input?: unknown) => {
    const declaration = shell.panels().find(
      (entry) => entry.providerId === providerId && entry.panelId === panelId,
    );
    if (!declaration) return;
    const panelRef: PanelRef = { instanceId: newInstanceId(), providerId, panelId };
    instance(panelRef, input); // mountを始めてからlayoutに入れる
    applyLayout((state) => addPanel(state, panelRef, target));
  };

  // ---- 別AreaControllerへの移譲 ----
  // detachはMapから先に外す — syncInstancesはlayoutから外れたInstanceを
  // disposeするので、layoutを書き換える前にMapから消しておく。
  const detach = (instanceId: string): { instance: PanelInstance; ref: PanelRef } | null => {
    const panelInstance = instances.get(instanceId);
    const result = detachPanel(layoutState, instanceId);
    if (!panelInstance || !result) return null;
    instances.delete(instanceId);
    applyLayout(() => result.state);
    return { instance: panelInstance, ref: result.ref };
  };
  const adopt = (panelInstance: PanelInstance, ref: PanelRef, target: MoveTarget): void => {
    instances.set(ref.instanceId, panelInstance);
    applyLayout((state) => addPanel(state, ref, target));
  };

  onCleanup(() => {
    for (const found of instances.values()) found.dispose();
    instances.clear();
    window.clearTimeout(saveTimer);
  });

  const controller: AreaController = {
    shell, ref,
    layout, applyLayout,
    instance, openPanel, detach, adopt,
    drag: shell.drag,
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
    () => {
      // update/disposeはInstanceのsignalを書く — owned scope(effect)内では
      // 書けないのでmicrotaskへ逃がす。dispose対象はcompute時の一覧では
      // なく実行時のlayoutStateから取る — panels一覧とworkspaceの非同期
      // 解決順でcomputeが空を返した直後にInstanceが生えると、古い一覧で
      // 生きたInstanceを捨ててしまう。
      queueMicrotask(() => untrack(syncInstances));
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
