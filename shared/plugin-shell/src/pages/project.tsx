import { A, useNavigate, useParams } from "@solidjs/router";
import { Columns3, GalleryHorizontal, Plus, Rows3 } from "lucide-solid";
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  useShellHost,
  type Dock, type PanelEntry, type PanelRef, type ProjectTree,
  type WsLeaf,
} from "../host";
import { loadFrameHidden, loadDockOpen, loadShelfOpen, loadSideOpen, loadWorkspaceMode, saveFrameHidden, saveDockOpen, saveLastLocation, saveShelfOpen, saveSideOpen, saveWorkspaceMode } from "../storage";
import { PanelInstance } from "../panels/instance";
import { TopBar } from "../top-bar";
import {
  SHELF, wsKey, newAreaId, emptyWsLeaf, toWsCenter,
  wsLeaves, wsLeafOf, lastWsLeaf,
  wsRemove, wsCollapseEmpty, wsSplitAt, wsSetRatio,
  type DockData, type DockKind, type DropEdge, type ShellLayout,
} from "./project/model";
import { TabScroller } from "./project/scroll";
import { DockView, Resizer } from "./project/dock";
import { WsTree } from "./project/workspace";
import { ShelfColumn } from "./project/shelf";
import { AreaTreeView } from "./project/area-tree";
import { createTabDrag } from "./project/drag";
import { actEffectOf, actLayerOf, actProgressOf, actToneOf } from "./project/activity";

export default function ProjectPage() {
  const host = useShellHost();
  const params = useParams();
  const navigate = useNavigate();
  const key = () => params.core ?? "";
  const project = () => params.project ?? "";
  const areaPath = () => (params.areaPath ?? "").split("/").filter((part) => part !== "");

  const [core] = createResource(key, (k) => host.getCore(k));
  const [projects, { refetch: refetchProjects }] = createResource(key, (k) => host.listProjects(k));
  const [panels, { refetch: refetchPanels }] = createResource(key, (k) => host.listPanels(k));
  const [error, setError] = createSignal("");
  const [sideOpen, setSideOpen] = createSignal(loadSideOpen());
  const toggleSide = () => {
    setSideOpen(!sideOpen());
    saveSideOpen(sideOpen());
  };
  const [shelfOpen, setShelfOpen] = createSignal(loadShelfOpen());
  const toggleShelf = () => {
    setShelfOpen(!shelfOpen());
    saveShelfOpen(shelfOpen());
  };
  const [dockOpen, setDockOpen] = createStore(loadDockOpen());
  const toggleDock = (kind: keyof typeof dockOpen) => {
    setDockOpen(kind, !dockOpen[kind]);
    saveDockOpen({ ...dockOpen });
  };
  // 区画（splitの作ったleaf）ごとにdisplay（tabs/scroll）を持つ。
  // 切替・新規leafの既定displayはactive leaf（選択中Panelを含むleaf）基準。
  const activeLeaf = () => {
    const center = activeLayout()?.center;
    if (!center) return undefined;
    return wsLeafOf(center.layout, center.selected) ?? lastWsLeaf(center.layout);
  };
  const toggleWsMode = () => {
    const target = activeKey();
    setLayout(produce((state) => {
      const center = state.ws[target]?.center;
      if (!center) return;
      const leaf = wsLeafOf(center.layout, center.selected) ?? lastWsLeaf(center.layout);
      leaf.display = leaf.display === "tabs" ? "scroll" : leaf.display === "scroll" ? "pages" : "tabs";
      saveWorkspaceMode(leaf.display);
    }));
    schedulePersist(target);
  };
  // 外側（frame: topbar/sidebar/shelf/status）を一時的に引っ込める状態。
  // 個別の開閉フラグは潰さずに保持するので、戻すと元の配置が復元される。
  const [frameHidden, setFrameHidden] = createSignal(loadFrameHidden());
  const toggleFrame = () => {
    setFrameHidden(!frameHidden());
    saveFrameHidden(frameHidden());
  };
  // 全領域の開閉: Mod+Alt+1..5 で画面左→右の順（collection, left, bottom, right, shelf）。
  // Mod+Alt+Z はframeをまとめて引っ込める/戻す。
  // e.codeを使うのはmacOSのOption+数字が別字（¡™等）に化けるため。
  // popupテスト: statusbarのボタンでFilesをtransient surfaceに開く。
  // Panel Instanceはdockと同じensureInstanceを使い、置き場所だけが違う。
  const [popupRef, setPopupRef] = createSignal<PanelRef | null>(null);
  const openFilesPopup = () => {
    const files = (panels() ?? []).find(
      (p) => p.panelId === "files" || p.title === "Files",
    );
    if (!files) return;
    setPopupRef({ instanceId: "popup:files", pluginId: files.pluginId, panelId: files.panelId });
  };
  const onShellKey = (e: KeyboardEvent) => {
    if (e.code === "Escape" && popupRef()) {
      setPopupRef(null);
      return;
    }
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
    if (e.code === "KeyZ") {
      e.preventDefault();
      toggleFrame();
      return;
    }
    const toggle = ({
      Digit1: toggleSide,
      Digit2: () => toggleDock("left"),
      Digit3: () => toggleDock("bottom"),
      Digit4: () => toggleDock("right"),
      Digit5: toggleShelf,
    } as const)[e.code as "Digit1"];
    if (!toggle) return;
    e.preventDefault();
    toggle();
  };
  onMount(() => window.addEventListener("keydown", onShellKey));
  onCleanup(() => window.removeEventListener("keydown", onShellKey));
  // work面は「topbarのseg-work + docks」の合成図形で、OS titlebar領域や
  // sidebar/shelfの開閉・resizeできのこ形・凸形に変わる。輪郭の接合部は
  // 段差の大きい側の角丸（凸角＝frameノッチ）＋欠けた象限に置くフィレット
  // 片（凹角＝canvasの四分円ディスク）で1本の弧として繋ぐ。揃った辺は直線。
  onMount(() => {
    const root = document.querySelector("main.shell");
    const seg = root?.querySelector(".seg-work");
    const body = root?.querySelector(".shell-body");
    const main = root?.querySelector(".shell-main");
    const fl = root?.querySelector(".shell-fillet-l");
    const fr = root?.querySelector(".shell-fillet-r");
    if (!(root instanceof HTMLElement) || !(seg instanceof HTMLElement) || !(body instanceof HTMLElement)
      || !(main instanceof HTMLElement) || !(fl instanceof HTMLElement) || !(fr instanceof HTMLElement)) return;
    const R = 10;
    const align = () => {
      const docks = root.querySelector(".shell-docks");
      if (!(docks instanceof HTMLElement)) return;
      const base = root.getBoundingClientRect();
      // topbarのframe区間は下のframe列（side/shelf＋resizer溝）以上の幅に
      // して、work面が逆凸（きのこ形）にならないようにする。
      const b = body.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      root.style.setProperty("--shell-side-w", `${m.left - b.left}px`);
      root.style.setProperty("--shell-shelf-w", `${b.right - m.right}px`);
      const s = seg.getBoundingClientRect();
      const d = docks.getBoundingClientRect();
      const seam = d.top;
      const disc = (at: string) =>
        `radial-gradient(${R}px at ${at}, var(--plugumi-colors-canvas) 98%, transparent)`;
      const joint = (
        overhang: number, // 負: seg側が出っ張り, 正: docks側が出っ張り
        segCorner: "borderBottomLeftRadius" | "borderBottomRightRadius",
        dockCorner: "borderTopLeftRadius" | "borderTopRightRadius",
        fillet: HTMLElement,
        stepX: number, // 凹角の頂点x（細い側の縁）
        side: "l" | "r",
      ) => {
        if (Math.abs(overhang) < 1) {
          seg.style[segCorner] = "0";
          docks.style[dockCorner] = "0";
          fillet.style.display = "none";
          return;
        }
        fillet.style.display = "block";
        if (overhang < 0) {
          // seg側の出っ張り: その下端角は凸角、凹角フィレットは段差の下側
          seg.style[segCorner] = `${R}px`;
          docks.style[dockCorner] = "0";
          fillet.style.left = `${stepX - (side === "l" ? R : 0) - base.left}px`;
          fillet.style.top = `${seam - base.top}px`;
          fillet.style.background = disc(side === "l" ? "100% 0" : "0 0");
        } else {
          seg.style[segCorner] = "0";
          docks.style[dockCorner] = `${R}px`;
          fillet.style.left = `${stepX - (side === "l" ? R : 0) - base.left}px`;
          fillet.style.top = `${seam - R - base.top}px`;
          fillet.style.background = disc(side === "l" ? "100% 100%" : "0 100%");
        }
      };
      joint(s.left - d.left, "borderBottomLeftRadius", "borderTopLeftRadius", fl, s.left < d.left ? d.left : s.left, "l");
      joint(d.right - s.right, "borderBottomRightRadius", "borderTopRightRadius", fr, d.right < s.right ? d.right : s.right, "r");
    };
    const ro = new ResizeObserver(align);
    ro.observe(seg);
    ro.observe(main);
    const mo = new MutationObserver(align);
    mo.observe(main, { childList: true, subtree: true });
    align();
    onCleanup(() => {
      ro.disconnect();
      mo.disconnect();
    });
  });
  // Instanceはページ生存中は保持する。
  const [layout, setLayout] = createStore<ShellLayout>({
    ws: {}, shelf: { panels: [], selected: "" },
  });
  const instances = new Map<string, PanelInstance>();
  const [loaded, setLoaded] = createSignal<Set<string>>(new Set());
  const persistTimers = new Map<string, number>();

  const panelTitle = (ref: PanelRef) =>
    (panels() ?? []).find(
      (panel) => panel.pluginId === ref.pluginId && panel.panelId === ref.panelId,
    )?.title ?? ref.panelId;

  const ensureInstance = (ref: PanelRef): PanelInstance => {
    let instance = instances.get(ref.instanceId);
    if (!instance) {
      instance = new PanelInstance(host, key(), ref, panelTitle(ref));
      instances.set(ref.instanceId, instance);
      instance.update(panels() ?? []);
    }
    return instance;
  };

  // 保存はレイアウト変更（追加・閉じる・選択）だけ。300msデバウンス。
  const schedulePersist = (target: string) => {
    const previous = persistTimers.get(target);
    if (previous !== undefined) clearTimeout(previous);
    persistTimers.set(target, window.setTimeout(() => {
      persistTimers.delete(target);
      void persist(target);
    }, 300));
  };

  const persist = async (target: string) => {
    try {
      if (target === SHELF) {
        await host.putShelf(key(), project(), toDock(layout.shelf));
      } else {
        const path = target.slice(3).split("/");
        const docks = layout.ws[target];
        if (!docks) return;
        await host.putWorkspace(key(), project(), path, {
          docks: {
            left: toDock(docks.left),
            center: {
              panels: docks.center.panels, selected: docks.center.selected,
              layout: docks.center.layout,
            },
            right: toDock(docks.right), bottom: toDock(docks.bottom),
          },
        });
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const toDock = (data: DockData): Dock => {
    const panels = data.panels;
    const selected =
      panels.some((panel) => panel.instanceId === data.selected)
        ? data.selected
        : panels.at(-1)?.instanceId ?? "";
    const dock: Dock = { panels, selected };
    if (data.sections) {
      // panelsから外れたinstanceのsection状態は保存しない（幽霊エントリ化を防ぐ）。
      const keep = new Set(panels.map((panel) => panel.instanceId));
      dock.shelfSections = Object.fromEntries(
        Object.entries(data.sections).filter(([id]) => keep.has(id)),
      );
    }
    return dock;
  };
  const fromDock = (dock: Dock): DockData => ({
    // 空DockはGo側がnullで返す。配列として正規化しないと
    // .length/.mapを読む全経路で落ちる。
    panels: dock.panels ?? [],
    selected: dock.selected,
    sections: dock.shelfSections,
  });

  // shelf と active Area のWorkspaceを読み込む（一度だけ）。
  const loadTarget = async (target: string) => {
    if (loaded().has(target)) return;
    setLoaded(new Set([...loaded(), target]));
    try {
      if (target === SHELF) {
        const shelf = await host.getShelf(key(), project());
        setLayout(produce((state) => {
          state.shelf = fromDock(shelf);
        }));
      } else {
        const path = target.slice(3).split("/");
        const workspace = await host.getWorkspace(key(), project(), path);
        setLayout(produce((state) => {
          state.ws[target] = {
            left: fromDock(workspace.docks.left),
            center: toWsCenter(workspace.docks.center),
            right: fromDock(workspace.docks.right),
            bottom: fromDock(workspace.docks.bottom),
          };
        }));
      }
      const all = target === SHELF
        ? layout.shelf.panels
        : [
          ...layout.ws[target].left.panels, ...layout.ws[target].right.panels,
          ...layout.ws[target].bottom.panels, ...layout.ws[target].center.panels,
        ];
      for (const ref of all) ensureInstance(ref);
    } catch (e) {
      setError(String(e));
    }
  };

  // この端末で最後に開いた場所として記録する（/:core/ の直行先）。
  createEffect(() => {
    if (project()) {
      saveLastLocation(
        key(),
        `/${key()}/${project()}/${areaPath().join("/")}/`.replace(/\/+$/, "/"),
      );
    }
  });

  createEffect(() => {
    if (project() === "") return;
    const target = wsKey(areaPath());
    // Area未選択（target=""）では読み込まない。shelfは常に読む。
    if (target !== "") void loadTarget(target);
    void loadTarget(SHELF);
  });

  // panelsとProjectツリーは定期的に取り直し、Instanceの登録追従を行う。
  const poll = setInterval(() => {
    refetchPanels();
    refetchProjects();
  }, 3000);
  onCleanup(() => clearInterval(poll));
  createResource(panels, (latest) => {
    for (const instance of instances.values()) instance.update(latest ?? []);
    return latest;
  });

  // scroll leafへ入れたPanelは、新しい列が見える位置まで外側をスクロールする。
  // 配置確定後のframeで探すためrequestAnimationFrameを挟む。
  const scrollColIntoView = (areaId: string, instanceId: string) => {
    requestAnimationFrame(() => {
      document
        .querySelector(`.ws-area[data-area-id="${areaId}"] [data-inst="${instanceId}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    });
  };

  // Dock操作（追加・閉じる・選択）は状態を変えて保存を予約する。
  // centerは1本のsplit treeを更新する。leafが中身の見せ方（tabs/scroll）を持つ。
  const addPanel = (
    target: string, kind: DockKind | "shelf", panel: PanelEntry,
  ) => {
    const ref: PanelRef = {
      instanceId: `panel-${crypto.randomUUID()}`,
      pluginId: panel.pluginId, panelId: panel.panelId,
    };
    ensureInstance(ref);
    setLayout(produce((state) => {
      if (kind === "center") {
        const center = state.ws[target].center;
        center.panels.push(ref);
        // 追加はtopbarの「+」からで、行き先は選択中leafに固定する。
        const leaf = wsLeafOf(center.layout, center.selected)
          ?? lastWsLeaf(center.layout);
        leaf.panels.push(ref);
        leaf.selected = ref.instanceId;
        center.selected = ref.instanceId;
        scrollColIntoView(leaf.id, ref.instanceId);
      } else {
        const dock = kind === "shelf" ? state.shelf : state.ws[target][kind];
        dock.panels.push(ref);
        dock.selected = ref.instanceId;
      }
    }));
    schedulePersist(target);
  };

  const closePanel = (target: string, kind: DockKind, ref: PanelRef) => {
    const instance = instances.get(ref.instanceId);
    instance?.dispose();
    instances.delete(ref.instanceId);
    setLayout(produce((state) => {
      if (kind === "center") {
        const center = state.ws[target].center;
        center.panels = center.panels.filter((panel) => panel.instanceId !== ref.instanceId);
        if (center.selected === ref.instanceId) {
          center.selected = center.panels.at(-1)?.instanceId ?? "";
        }
        center.layout = wsRemove(center.layout, ref.instanceId) ?? emptyWsLeaf(loadWorkspaceMode());
      } else {
        const dock = state.ws[target][kind];
        dock.panels = dock.panels.filter((panel) => panel.instanceId !== ref.instanceId);
        if (dock.selected === ref.instanceId) {
          dock.selected = dock.panels.at(-1)?.instanceId ?? "";
        }
      }
    }));
    schedulePersist(target);
  };

  const selectPanel = (target: string, kind: DockKind, ref: PanelRef) => {
    if (suppressSelect()) return;
    setLayout(produce((state) => {
      if (kind === "center") {
        const center = state.ws[target].center;
        const leaf = wsLeafOf(center.layout, ref.instanceId);
        if (leaf) leaf.selected = ref.instanceId;
        center.selected = ref.instanceId;
      } else {
        state.ws[target][kind].selected = ref.instanceId;
      }
    }));
    schedulePersist(target);
  };

  // shelfの積層section状態を更新する。keyはinstanceId。
  const setShelfSection = (
    id: string, patch: { collapsed?: boolean; grow?: number },
  ) => {
    setLayout(produce((state) => {
      const dock = state.shelf;
      dock.sections = {
        ...(dock.sections ?? {}),
        [id]: { ...(dock.sections?.[id] ?? {}), ...patch },
      };
    }));
    schedulePersist(SHELF);
  };

  // resizer確定時にDOM上のflexGrowをstateへ書き戻す。
  // 並び替えでid対応がずれないよう、styleではなくdata-instから引く。
  const persistShelfGrows = (grows: Record<string, number>) => {
    setLayout(produce((state) => {
      const dock = state.shelf;
      dock.sections = { ...(dock.sections ?? {}) };
      for (const [id, grow] of Object.entries(grows)) {
        dock.sections[id] = { ...(dock.sections[id] ?? {}), grow };
      }
    }));
    schedulePersist(SHELF);
  };

  // shelfから外してactive areaのcenter末尾leafへ戻す。
  // area無しでは行き先が無いのでinstanceごと閉じる。
  const unpinPanel = (ref: PanelRef) => {
    const target = activeKey();
    if (target && layout.ws[target]) {
      const center = layout.ws[target].center;
      const leaf = wsLeafOf(center.layout, center.selected) ?? lastWsLeaf(center.layout);
      moveWsPanel(target, ref, leaf.id, Number.MAX_SAFE_INTEGER);
      return;
    }
    instances.get(ref.instanceId)?.dispose();
    instances.delete(ref.instanceId);
    setLayout(produce((state) => {
      detachPanel(state, SHELF, ref);
    }));
    schedulePersist(SHELF);
  };

  // refを所属regionから外す。ws centerなら両treeとflatから、dockならそのpanelsから。
  // targetのwsを先に探し、見つからなければProject共通のshelfも探す
  // （cross-region移動はどこに置かれていても外せる必要がある）。
  // 戻り値は見つかったか。dock/leafの空選択も次のPanelに進める。
  const detachPanel = (state: ShellLayout, target: string, ref: PanelRef): boolean => {
    const workspace = state.ws[target];
    if (workspace) {
      const center = workspace.center;
      if (center.panels.some((panel) => panel.instanceId === ref.instanceId)) {
        center.panels = center.panels.filter((panel) => panel.instanceId !== ref.instanceId);
        center.layout = wsRemove(center.layout, ref.instanceId) ?? emptyWsLeaf(loadWorkspaceMode());
        if (center.selected === ref.instanceId) {
          center.selected = center.panels.at(-1)?.instanceId ?? "";
        }
        return true;
      }
      for (const kind of ["left", "right", "bottom"] as const) {
        const dock = workspace[kind];
        const i = dock.panels.findIndex((panel) => panel.instanceId === ref.instanceId);
        if (i < 0) continue;
        dock.panels.splice(i, 1);
        if (dock.selected === ref.instanceId) {
          dock.selected = dock.panels.at(-1)?.instanceId ?? "";
        }
        return true;
      }
    }
    const shelf = state.shelf;
    const pi = shelf.panels.findIndex((panel) => panel.instanceId === ref.instanceId);
    if (pi < 0) return false;
    shelf.panels.splice(pi, 1);
    if (shelf.selected === ref.instanceId) {
      shelf.selected = shelf.panels.at(-1)?.instanceId ?? "";
    }
    return true;
  };

  // refをleafのindex位置へ移す（同じleaf内なら並び替え）。空leafは縮約。
  // refがws tree外（別dock）にあればdetachしてleafへ挿入する（cross-region移動）。
  const moveWsPanel = (
    target: string, ref: PanelRef,
    areaId: string, index: number,
  ) => {
    setLayout(produce((state) => {
      const center = state.ws[target].center;
      const leaves = wsLeaves(center.layout);
      const source = leaves.find((area) => area.panels.some((panel) => panel.instanceId === ref.instanceId));
      const dest = leaves.find((area) => area.id === areaId);
      if (!dest) return;
      if (!source) {
        // ws tree外からの挿入: dock/shelfからdetachしてleafへ。
        if (!detachPanel(state, target, ref)) return;
        if (!center.panels.some((panel) => panel.instanceId === ref.instanceId)) {
          center.panels.push(ref);
        }
        dest.panels.splice(Math.min(index, dest.panels.length), 0, ref);
        dest.selected = ref.instanceId;
        center.selected = ref.instanceId;
        return;
      }
      const pos = source.panels.findIndex((panel) => panel.instanceId === ref.instanceId);
      source.panels.splice(pos, 1);
      // 同じleaf内の移動は、抜いた分だけindexがずれる。
      const insertAt = Math.min(source === dest && pos < index ? index - 1 : index, dest.panels.length);
      dest.panels.splice(insertAt, 0, ref);
      if (source !== dest && source.panels.length === 0) {
        center.layout = wsCollapseEmpty(center.layout) ?? emptyWsLeaf(loadWorkspaceMode());
      }
      dest.selected = ref.instanceId;
      center.selected = ref.instanceId;
    }));
    // scroll表示のleafなら列が見えるよう外側scrollする（tabs表示ではno-op）。
    scrollColIntoView(areaId, ref.instanceId);
    // detachが別regionを触り得るので両方persistする。
    schedulePersist(target);
    schedulePersist(SHELF);
  };

  // refをdock（left/right/bottom/shelf）へ移す。ws center・別dock・shelf
  // どこにあってもdetachして挿入する。同じdock内なら並び替え。
  const movePanelToDock = (
    target: string, ref: PanelRef,
    dock: "left" | "right" | "bottom" | "shelf", index: number,
  ) => {
    setLayout(produce((state) => {
      const dest = dock === "shelf" ? state.shelf : state.ws[target][dock];
      const sameIdx = dest.panels.findIndex((panel) => panel.instanceId === ref.instanceId);
      if (!detachPanel(state, target, ref)) return;
      const insertAt = Math.min(
        sameIdx >= 0 && sameIdx < index ? index - 1 : index,
        dest.panels.length,
      );
      dest.panels.splice(insertAt, 0, ref);
      dest.selected = ref.instanceId;
    }));
    schedulePersist(target);
    schedulePersist(SHELF);
  };

  // refをowner leafから外して、target leafのedge側に新leafとして挿す（split）。
  // scroll表示のleafではhitTest側がtop/bottomのみsplitにする。対象leafが
  // refだけを持つ場合は何もしない。
  // refがws tree外（dock）にあればdetachして新leafへ置く。
  const splitWsPanel = (
    target: string, ref: PanelRef,
    areaId: string, edge: DropEdge,
  ) => {
    setLayout(produce((state) => {
      const center = state.ws[target].center;
      const leaves = wsLeaves(center.layout);
      const source = leaves.find((leaf) => leaf.panels.some((panel) => panel.instanceId === ref.instanceId));
      const dest = leaves.find((leaf) => leaf.id === areaId);
      if (!dest) return;
      if (source && source === dest && source.panels.length === 1) return;
      if (source) {
        center.layout = wsRemove(center.layout, ref.instanceId) ?? emptyWsLeaf(loadWorkspaceMode());
      } else {
        // ws tree外（dock）からのsplit: detachして新leafへ置く。
        if (!detachPanel(state, target, ref)) return;
        center.panels.push(ref);
      }
      // 新しいleafは分割元のdisplayを継ぐ（scroll区画を割る→scroll区画になる）。
      const leaf: WsLeaf = {
        kind: "leaf", id: newAreaId(), panels: [ref],
        selected: ref.instanceId, display: dest.display,
      };
      center.layout = wsSplitAt(center.layout, areaId, edge, leaf);
      center.selected = ref.instanceId;
    }));
    schedulePersist(target);
    schedulePersist(SHELF);
  };

  // split nodeのresizerから比率を更新する。
  const setWsRatio = (target: string, nodeId: string, ratio: number) => {
    setLayout(produce((state) => {
      wsSetRatio(state.ws[target].center.layout, nodeId, ratio);
    }));
    schedulePersist(target);
  };
  // Areaツリー操作。
  const addArea = async (parent: string[]) => {
    const name = window.prompt("Area名（小文字slug）");
    if (!name) return;
    setError("");
    try {
      await host.createArea(key(), project(), parent, name);
      await refetchProjects();
    } catch (e) {
      setError(String(e));
    }
  };
  const removeArea = async (path: string[]) => {
    if (!window.confirm(`Area ${path.join("/")} を削除しますか？`)) return;
    setError("");
    try {
      await host.deleteArea(key(), project(), path);
      await refetchProjects();
    } catch (e) {
      setError(String(e));
    }
  };

  const currentTree = (): ProjectTree | undefined =>
    (projects() ?? []).find((tree) => tree.name === project());

  // ページを離れたら全Instanceをdestroyする。debounce中の保存は
  // そのまま捨てると直前の操作が消えるので、離脱前にflushする。
  onCleanup(() => {
    const pending = [...persistTimers.keys()];
    for (const timer of persistTimers.values()) clearTimeout(timer);
    persistTimers.clear();
    for (const target of pending) {
      if (target === SHELF || layout.ws[target]) void persist(target);
    }
    for (const instance of instances.values()) instance.dispose();
  });

  const activeKey = () => wsKey(areaPath());
  const activeLayout = () => layout.ws[activeKey()];

  const { ghost, pressTab, suppressSelect } = createTabDrag({
    panelTitle, activeKey, moveWsPanel, splitWsPanel, movePanelToDock,
  });

  return (
    <main class="shell" classList={{ "frame-hidden": frameHidden() }}>
      {/* PWAのWindow Controls OverlayとElectronのウィンドウ操作が載るOS領域。
          innerはOSの操作領域を避けたtitlebar-area。Shell固有のTopBarを置く。 */}
      <header class="shell-os">
        <div class="shell-os-inner">
          <TopBar
            coreKey={key()} core={core}
            sideOpen={sideOpen()} onToggleSide={toggleSide}
            dockOpen={dockOpen} onToggleDock={toggleDock}
            shelfOpen={shelfOpen()} onToggleShelf={toggleShelf}
            frameHidden={frameHidden()} onToggleFrame={toggleFrame}
            panels={panels() ?? []}
            onAddPanel={(panel) => {
              if (!activeLayout()) return;
              addPanel(activeKey(), "center", panel);
            }}
          />
        </div>
      </header>
      <div class="shell-body">
        <Show when={sideOpen()}>
        <aside class="shell-side">
          <div class="project-tabs">
            <TabScroller>
              <For each={projects() ?? []}>
                {(tree) => (
                  <span
                    class="shell-tab"
                    classList={{ active: tree.name === project() }}
                  >
                    <A href={`/${key()}/${tree.name}/`}>{tree.name}</A>
                    <span
                      class="close" role="button" aria-label="delete"
                      onClick={() => {
                        if (!window.confirm(`Project ${tree.name} を削除しますか？`)) return;
                        const deletingActive = tree.name === project();
                        void host.deleteProject(key(), tree.name)
                          .then(() => refetchProjects())
                          .then(() => {
                            // 開いていたProjectを消したら直行判定へ戻す。
                            if (deletingActive) navigate(`/${key()}/`, { replace: true });
                          })
                          .catch((e: unknown) => setError(String(e)));
                      }}
                    >
                      ×
                    </span>
                  </span>
                )}
              </For>
            </TabScroller>
            <button
              class="shell-add"
              onClick={() => {
                const name = window.prompt("Project名（小文字slug）");
                if (!name) return;
                void host.createProject(key(), name)
                  .then(() => refetchProjects())
                  .then(() => navigate(`/${key()}/${name}/`))
                  .catch((e: unknown) => setError(String(e)));
              }}
            >
              +
            </button>
          </div>
          <div class="area-card">
            <div class="area-scroll">
              <AreaTreeView
                nodes={currentTree()?.areas ?? []}
              path={[]}
                base={`/${key()}/${project()}`}
                active={areaPath().join("/")}
                onAdd={addArea}
                onRemove={removeArea}
              />
            </div>
            <div class="area-foot">
              <button class="area-add" onClick={() => addArea([])}>
                <Plus size={12} /> Area
              </button>
              <button
                class="dock-toggle"
                title={`区画を${activeLeaf()?.display === "tabs" ? "scroll" : activeLeaf()?.display === "scroll" ? "pages" : "tabs"}表示にする`}
                onClick={toggleWsMode}
              >
                <Show when={activeLeaf()?.display === "pages"} fallback={
                  <Show when={activeLeaf()?.display === "scroll"} fallback={<Columns3 size={13} />}>
                    <GalleryHorizontal size={13} />
                  </Show>
                }>
                  <Rows3 size={13} />
                </Show>
              </button>
            </div>
          </div>
          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </aside>
        <Resizer />
        </Show>
        <section class="shell-main">
          <Show
            when={project() !== ""}
            fallback={<p class="placeholder">Project を作成してください</p>}
          >
            <Show
              when={areaPath().length > 0}
              fallback={<p class="placeholder">Area を選択してください</p>}
            >
            <Show when={activeLayout()} fallback={<p class="placeholder">読み込み中…</p>}>
              <div class="shell-docks">
                <DockView
                  kind="left" data={activeLayout()!.left}
                  collapsed={!dockOpen.left}
                  panels={panels() ?? []}
                  instance={(ref) => ensureInstance(ref)}
                  onClose={(ref) => closePanel(activeKey(), "left", ref)}
                  onSelect={(ref) => selectPanel(activeKey(), "left", ref)}
                  onPressTab={pressTab}
                />
                <Show when={dockOpen.left}>
                  <Resizer />
                </Show>
                <div class="shell-center-col">
                  <WsTree
                    node={activeLayout()!.center.layout}
                    panels={panels() ?? []}
                    instance={(ref) => ensureInstance(ref)}
                    onClose={(ref) => closePanel(activeKey(), "center", ref)}
                    onSelect={(ref) => selectPanel(activeKey(), "center", ref)}
                    onPressTab={pressTab}
                    onRatio={(nodeId, ratio) => setWsRatio(activeKey(), nodeId, ratio)}
                  />
                  <Show when={ghost()}>
                    {(g) => (
                      <div class="drag-ghost" style={{ left: `${g().x + 8}px`, top: `${g().y + 8}px` }}>
                        {g().title}
                      </div>
                    )}
                  </Show>
                  <Show when={dockOpen.bottom}>
                    <Resizer vertical />
                  </Show>
                  <DockView
                    kind="bottom" data={activeLayout()!.bottom}
                    collapsed={!dockOpen.bottom}
                    panels={panels() ?? []}
                    instance={(ref) => ensureInstance(ref)}
                    onClose={(ref) => closePanel(activeKey(), "bottom", ref)}
                    onSelect={(ref) => selectPanel(activeKey(), "bottom", ref)}
                    onPressTab={pressTab}
                  />
                </div>
                <Show when={dockOpen.right}>
                  <Resizer />
                </Show>
                <DockView
                  kind="right" data={activeLayout()!.right}
                  collapsed={!dockOpen.right}
                  panels={panels() ?? []}
                  instance={(ref) => ensureInstance(ref)}
                  onClose={(ref) => closePanel(activeKey(), "right", ref)}
                  onSelect={(ref) => selectPanel(activeKey(), "right", ref)}
                  onPressTab={pressTab}
                />
              </div>
            </Show>
            </Show>
          </Show>
        </section>
        <Show when={shelfOpen()}>
        <Resizer />
        <aside class="shell-shelf">
          <Show when={project() !== ""} fallback={<p class="placeholder">Project を作成してください</p>}>
          <Show when={loaded().has(SHELF)}>
            <ShelfColumn
              data={layout.shelf}
              panels={panels() ?? []}
              instance={(ref) => ensureInstance(ref)}
              onToggle={(ref) => {
                // drag確定直後のclickはcollapse扱いしない（DnDのclick抑制と同じ窓）。
                if (suppressSelect()) return;
                setShelfSection(ref.instanceId, {
                  collapsed: !layout.shelf.sections?.[ref.instanceId]?.collapsed,
                });
              }}
              onUnpin={unpinPanel}
              onPressTab={pressTab}
              onSyncGrows={persistShelfGrows}
            />
          </Show>
          </Show>
        </aside>
        </Show>
      </div>
      {/* work面（seg-work + docks）の合成図形の凹角に置くフィレット片。
         位置・向きはonMountの実測で決まる。 */}
      <div class="shell-fillet shell-fillet-l" />
      <div class="shell-fillet shell-fillet-r" />
      {/* Indicator（Plugin View）のマウント領域。protocol未実装のため今は空。 */}
      <footer class="shell-status">
        <button class="shell-add popup-btn" onClick={openFilesPopup}>Filesをpopup</button>
        <div class="shell-indicators" />
      </footer>
      {/* popup: transientなsurface。枠はdock-cardと同じ縁を使い、
         activityも同じattribute経路でframeに描かれる。 */}
      <Show when={popupRef()}>
        {(ref) => {
          const inst = () => ensureInstance(ref());
          return (
            <div class="popup-backdrop" onClick={() => setPopupRef(null)}>
              <section
                class="shell-popup dock-card"
                onClick={(e) => e.stopPropagation()}
                attr:data-activity-tone={actToneOf(inst())}
                attr:data-activity-border={actEffectOf(inst(), "border")}
                attr:data-activity-busy={inst().activity()?.busy || undefined}
              >
                <header class="popup-head" attr:data-activity-tone={actLayerOf(inst(), "header")?.tone}>
                  <span class="popup-title">{inst().title}</span>
                  <button class="dock-toggle" onClick={() => setPopupRef(null)}>×</button>
                </header>
                <div
                  class="popup-body dock-panel"
                  attr:data-activity-divider={actEffectOf(inst(), "divider")}
                  attr:data-activity-content={actEffectOf(inst(), "content")}
                  attr:aria-busy={inst().activity()?.busy || undefined}
                  style={actProgressOf(inst())}
                >
                  {inst().host}
                  <Show when={inst().state() === "missing"}>
                    <p class="placeholder">Panelが見つかりません</p>
                  </Show>
                  <Show when={inst().error()}>
                    {(err) => (
                      <p class="placeholder">
                        {err().message}{" "}
                        <button onClick={() => inst().retry(panels() ?? [])}>再試行</button>
                      </p>
                    )}
                  </Show>
                </div>
              </section>
            </div>
          );
        }}
      </Show>
    </main>
  );
}
