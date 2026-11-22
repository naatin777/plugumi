import { A, useNavigate, useParams } from "@solidjs/router";
import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  useShellHost,
  type AreaTree, type Dock, type PanelEntry, type PanelRef, type ProjectTree,
} from "../host";
import { loadPinnedOpen, loadSideOpen, saveLastLocation, savePinnedOpen, saveSideOpen } from "../storage";
import { PanelInstance } from "../panels/instance";
import { TopBar } from "../top-bar";

type DockKind = "left" | "center" | "right" | "bottom";
const dockKinds: DockKind[] = ["left", "center", "right", "bottom"];

interface DockData {
  panels: PanelRef[];
  selected: string;
}

const emptyDocks = (): Record<DockKind, DockData> => ({
  left: { panels: [], selected: "" }, center: { panels: [], selected: "" },
  right: { panels: [], selected: "" }, bottom: { panels: [], selected: "" },
});

// Workspaceのキー。pinnedはProject単位でArea切替に左右されない。
const PINNED = "pinned";
const wsKey = (path: string[]) => (path.length === 0 ? "" : `ws:${path.join("/")}`);

// /:core/:project/* の画面。左: Projectタブ+Areaツリー、中央: 4 Dock、
// 右: Pinned Dock、最下段: ステータスバー。
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
  const [pinnedOpen, setPinnedOpen] = createSignal(loadPinnedOpen());
  const togglePinned = () => {
    setPinnedOpen(!pinnedOpen());
    savePinnedOpen(pinnedOpen());
  };

  // layout["pinned"|"ws:a/b"] = 4 Dock。Instanceはページ生存中は保持する。
  const [layout, setLayout] = createStore<Record<string, Record<DockKind, DockData>>>({});
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
      if (target === PINNED) {
        await host.putPinned(key(), project(), toDock(layout[PINNED].left));
      } else {
        const path = target.slice(3).split("/");
        const docks = layout[target];
        await host.putWorkspace(key(), project(), path, {
          docks: {
            left: toDock(docks.left), center: toDock(docks.center),
            right: toDock(docks.right), bottom: toDock(docks.bottom),
          },
        });
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const toDock = (data: DockData): Dock => ({ panels: data.panels, selected: data.selected });

  // pinned と active Area のWorkspaceを読み込む（一度だけ）。
  const loadTarget = async (target: string) => {
    if (loaded().has(target)) return;
    setLoaded(new Set([...loaded(), target]));
    try {
      if (target === PINNED) {
        const pinned = await host.getPinned(key(), project());
        setLayout(produce((state) => {
          state[PINNED] = emptyDocks();
          state[PINNED].left = { panels: pinned.panels, selected: pinned.selected };
        }));
      } else {
        const path = target.slice(3).split("/");
        const workspace = await host.getWorkspace(key(), project(), path);
        setLayout(produce((state) => {
          state[target] = {
            left: { panels: workspace.docks.left.panels, selected: workspace.docks.left.selected },
            center: { panels: workspace.docks.center.panels, selected: workspace.docks.center.selected },
            right: { panels: workspace.docks.right.panels, selected: workspace.docks.right.selected },
            bottom: { panels: workspace.docks.bottom.panels, selected: workspace.docks.bottom.selected },
          };
        }));
      }
      for (const kind of dockKinds) {
        for (const ref of layout[target][kind].panels) ensureInstance(ref);
      }
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
    // Area未選択（target=""）では読み込まない。pinnedは常に読む。
    if (target !== "") void loadTarget(target);
    void loadTarget(PINNED);
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

  // Dock操作（追加・閉じる・選択）は状態を変えて保存を予約する。
  const addPanel = (target: string, kind: DockKind, panel: PanelEntry) => {
    const ref: PanelRef = {
      instanceId: `panel-${crypto.randomUUID()}`,
      pluginId: panel.pluginId, panelId: panel.panelId,
    };
    ensureInstance(ref);
    setLayout(produce((state) => {
      state[target][kind].panels.push(ref);
      state[target][kind].selected = ref.instanceId;
    }));
    schedulePersist(target);
  };

  const closePanel = (target: string, kind: DockKind, ref: PanelRef) => {
    const instance = instances.get(ref.instanceId);
    instance?.dispose();
    instances.delete(ref.instanceId);
    setLayout(produce((state) => {
      const dock = state[target][kind];
      dock.panels = dock.panels.filter((panel) => panel.instanceId !== ref.instanceId);
      if (dock.selected === ref.instanceId) {
        dock.selected = dock.panels.at(-1)?.instanceId ?? "";
      }
    }));
    schedulePersist(target);
  };

  const selectPanel = (target: string, kind: DockKind, ref: PanelRef) => {
    setLayout(produce((state) => {
      state[target][kind].selected = ref.instanceId;
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

  // ページを離れたら全Instanceをdestroyする。
  onCleanup(() => {
    for (const timer of persistTimers.values()) clearTimeout(timer);
    for (const instance of instances.values()) instance.dispose();
  });

  const activeKey = () => wsKey(areaPath());
  const activeLayout = () => layout[activeKey()];

  return (
    <main class="shell">
      {/* PWAのWindow Controls OverlayとElectronのウィンドウ操作が載るOS領域。
          innerはOSの操作領域を避けたtitlebar-area。Shell固有のTopBarを置く。 */}
      <header class="shell-os">
        <div class="shell-os-inner">
          <TopBar
            coreKey={key()} core={core}
            sideOpen={sideOpen} onToggleSide={toggleSide}
            pinnedOpen={pinnedOpen} onTogglePinned={togglePinned}
          />
        </div>
      </header>
      <div class="shell-body">
        <Show when={sideOpen()}>
        <aside class="shell-side">
          <div class="project-tabs">
            <For each={projects() ?? []}>
              {(tree) => (
                <span
                  class="project-tab"
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
            <button
              class="project-add"
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
            <AreaTreeView
              nodes={currentTree()?.areas ?? []}
            path={[]}
              base={`/${key()}/${project()}`}
              active={areaPath().join("/")}
              onAdd={addArea}
              onRemove={removeArea}
            />
          </div>
          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </aside>
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
                  panels={panels() ?? []}
                  instance={(ref) => ensureInstance(ref)}
                  onAdd={(panel) => addPanel(activeKey(), "left", panel)}
                  onClose={(ref) => closePanel(activeKey(), "left", ref)}
                  onSelect={(ref) => selectPanel(activeKey(), "left", ref)}
                />
                <div class="shell-center-col">
                  <DockView
                    kind="center" data={activeLayout()!.center}
                    panels={panels() ?? []}
                    instance={(ref) => ensureInstance(ref)}
                    onAdd={(panel) => addPanel(activeKey(), "center", panel)}
                    onClose={(ref) => closePanel(activeKey(), "center", ref)}
                    onSelect={(ref) => selectPanel(activeKey(), "center", ref)}
                  />
                  <DockView
                    kind="bottom" data={activeLayout()!.bottom}
                    panels={panels() ?? []}
                    instance={(ref) => ensureInstance(ref)}
                    onAdd={(panel) => addPanel(activeKey(), "bottom", panel)}
                    onClose={(ref) => closePanel(activeKey(), "bottom", ref)}
                    onSelect={(ref) => selectPanel(activeKey(), "bottom", ref)}
                  />
                </div>
                <DockView
                  kind="right" data={activeLayout()!.right}
                  panels={panels() ?? []}
                  instance={(ref) => ensureInstance(ref)}
                  onAdd={(panel) => addPanel(activeKey(), "right", panel)}
                  onClose={(ref) => closePanel(activeKey(), "right", ref)}
                  onSelect={(ref) => selectPanel(activeKey(), "right", ref)}
                />
              </div>
            </Show>
            </Show>
          </Show>
        </section>
        <Show when={pinnedOpen()}>
        <aside class="shell-pinned">
          <Show when={project() !== ""} fallback={<p class="placeholder">Project を作成してください</p>}>
          <Show when={layout[PINNED]}>
            <DockView
              kind="pinned" data={layout[PINNED].left}
              panels={panels() ?? []}
              instance={(ref) => ensureInstance(ref)}
              onAdd={(panel) => addPanel(PINNED, "left", panel)}
              onClose={(ref) => closePanel(PINNED, "left", ref)}
              onSelect={(ref) => selectPanel(PINNED, "left", ref)}
            />
          </Show>
          </Show>
        </aside>
        </Show>
      </div>
      <footer class="shell-status">
        <span class="status-text">{params.core} — {core()?.status ?? "…"}</span>
        {/* Indicator（Plugin View）のマウント領域。protocol未実装のため今は空。 */}
        <div class="shell-indicators" />
      </footer>
    </main>
  );
}

// 1つのDock: Panelタブ＋「+」picker＋各Instanceのhost。
function DockView(props: {
  kind: string;
  data: DockData;
  panels: PanelEntry[];
  instance: (ref: PanelRef) => PanelInstance;
  onAdd: (panel: PanelEntry) => void;
  onClose: (ref: PanelRef) => void;
  onSelect: (ref: PanelRef) => void;
}) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  return (
    <div class={`dock dock-${props.kind}`}>
      <div class="dock-tabs">
        <For each={props.data.panels}>
          {(ref) => {
            const instance = () => props.instance(ref);
            return (
              <button
                class="panel-tab"
                classList={{ active: props.data.selected === ref.instanceId }}
                onClick={() => props.onSelect(ref)}
              >
                {instance().title}
                <span
                  class="close" role="button" aria-label="close"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onClose(ref);
                  }}
                >
                  ×
                </span>
              </button>
            );
          }}
        </For>
        <button class="dock-add" onClick={() => setPickerOpen(!pickerOpen())}>+</button>
      </div>
      <div class="dock-card">
      <Show when={pickerOpen()}>
        <div class="dock-picker">
          <For each={props.panels}>
            {(panel) => (
              <button
                onClick={() => {
                  props.onAdd(panel);
                  setPickerOpen(false);
                }}
              >
                {panel.title} <span class="meta">{panel.pluginId}/{panel.panelId}</span>
              </button>
            )}
          </For>
          <Show when={props.panels.length === 0}>
            <p class="meta">Panelはありません</p>
          </Show>
        </div>
      </Show>
      <div class="dock-hosts">
        <For each={props.data.panels}>
          {(ref) => {
            const instance = props.instance(ref);
            return (
              <div
                class="dock-panel"
                classList={{ hidden: props.data.selected !== ref.instanceId }}
              >
                {instance.host}
                <Show when={instance.state() === "missing"}>
                  <div class="panel-message"><p>提供元のPluginが見つかりません</p></div>
                </Show>
                <Show when={instance.error()}>
                  {(mountError) => (
                    <div class="panel-message">
                      <p><span class="kind">{mountError().kind}</span>: {mountError().message}</p>
                      <button onClick={() => instance.retry(props.panels)}>再試行</button>
                    </div>
                  )}
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      </div>
    </div>
  );
}

// Areaのツリー。展開/選択/子作成/削除。
function AreaTreeView(props: {
  nodes: AreaTree[];
  path: string[];
  base: string;
  active: string;
  onAdd: (parent: string[]) => void;
  onRemove: (path: string[]) => void;
}) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const toggle = (path: string) => {
    const next = new Set(expanded());
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setExpanded(next);
  };
  return (
    <ul class="area-tree">
      <For each={props.nodes}>
        {(node) => {
          const path = [...props.path, node.name];
          const joined = () => path.join("/");
          return (
            <li>
              <div class="area-row" classList={{ active: props.active === joined() }}>
                <Show when={node.areas.length > 0} fallback={<span class="area-tw" />}>
                  <button class="area-tw" onClick={() => toggle(joined())}>
                    {expanded().has(joined()) ? "▾" : "▸"}
                  </button>
                </Show>
                <A href={`${props.base}/${joined()}/`}>{node.name}</A>
                <button class="area-op" onClick={() => props.onAdd(path)}>+</button>
                <button class="area-op" onClick={() => props.onRemove(path)}>×</button>
              </div>
              <Show when={expanded().has(joined()) || props.active.startsWith(joined())}>
                <AreaTreeView
                  nodes={node.areas} path={path} base={props.base}
                  active={props.active} onAdd={props.onAdd} onRemove={props.onRemove}
                />
              </Show>
            </li>
          );
        }}
      </For>
      <Show when={props.path.length === 0}>
        <li><button class="area-op add-root" onClick={() => props.onAdd([])}>+ Area</button></li>
      </Show>
    </ul>
  );
}
