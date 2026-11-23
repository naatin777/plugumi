// Workspace・Pinnedの保存モデルと純粋な操作群。
// SolidやDOMには触れない。状態はプレーンなJSONの形だけで持ち、
// 操作は新しい状態を返す（呼び出し側がstoreに置き直す）。
// 不変条件（designs/00005「保存の形」）:
// - 1つのPanel InstanceはWorkspace・Pinnedのどこか1箇所にだけある
// - centerのPanelは木のleafにだけ置く
// - 空のleafはsplitを畳む（rootのleafは空でも残す）
// - selectedはstring|nullで、panels内のinstanceIdかnull

export type PanelRef = {
  instanceId: string;
  pluginId: string;
  panelId: string;
};

export type DockKind = "left" | "right" | "bottom";
export const dockKinds: DockKind[] = ["left", "bottom", "right"];

export type Stack = {
  panels: PanelRef[];
  selected: string | null;
};

export type Leaf = {
  kind: "leaf";
  id: string;
  panels: PanelRef[];
  selected: string | null;
};

export type Split = {
  kind: "split";
  id: string;
  axis: "x" | "y";
  ratio: number;
  first: Node;
  second: Node;
};

export type Node = Leaf | Split;

export type WorkspaceState = {
  version: 1;
  left: Stack;
  right: Stack;
  bottom: Stack;
  center: { root: Node; focusedLeaf: string };
};

// pinned: Projectに1つ。Areaをまたいで常時見えるwidgetのリスト。
// 列は行リスト（side）と選択中のwidgetの中身（main）で構成し、
// 中身を出すのはselectedの1つだけ。panel↔widgetの変換はない
// （isCrossingが跨ぎ移動を捨てる）。
export type PinnedWidget = {
  panel: PanelRef;
};

export type PinnedState = {
  version: 1;
  widgets: PinnedWidget[];
  selected: string | null;
};

// Workspace+Pinnedを1つの状態として扱う（領域をまたぐ移動を1操作にする）。
export type LayoutState = {
  workspace: WorkspaceState;
  pinned: PinnedState;
};

// 領域をまたぐ移動の向き。
export type Edge = "left" | "right" | "top" | "bottom";

// Panelが今いる場所。
export type PanelLocation =
  | { region: "dock"; dock: DockKind }
  | { region: "leaf"; leafId: string }
  | { region: "pinned" };

// 移動先。indexは挿入位置。splitはleafのedge側に新しいleafを作って入れる。
export type MoveTarget =
  | { region: "dock"; dock: DockKind; index: number }
  | { region: "leaf"; leafId: string; index: number }
  | { region: "pinned"; index: number }
  | { region: "split"; leafId: string; edge: Edge };

export const emptyStack = (): Stack => ({ panels: [], selected: null });

const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

export const newInstanceId = (): string => newId("panel");

export const emptyLeaf = (): Leaf => ({
  kind: "leaf",
  id: newId("leaf"),
  panels: [],
  selected: null,
});

// rootのleafはdecodeの壊れた入力・初期状態・全削除で共通して使うため、
// 固定idを持つ（focusedLeafのfallback先）。
export const rootLeaf = (): Leaf => ({
  kind: "leaf",
  id: "leaf-root",
  panels: [],
  selected: null,
});

export const emptyWorkspace = (): WorkspaceState => ({
  version: 1,
  left: emptyStack(),
  right: emptyStack(),
  bottom: emptyStack(),
  center: { root: rootLeaf(), focusedLeaf: "leaf-root" },
});

export const emptyPinned = (): PinnedState => ({ version: 1, widgets: [], selected: null });

const newWidget = (panel: PanelRef): PinnedWidget => ({ panel });

export const emptyLayout = (): LayoutState => ({
  workspace: emptyWorkspace(),
  pinned: emptyPinned(),
});

// ---- 木の走査 ----

export function findLeaf(node: Node, id: string): Leaf | undefined {
  if (node.kind === "leaf") return node.id === id ? node : undefined;
  return findLeaf(node.first, id) ?? findLeaf(node.second, id);
}

export function allLeaves(node: Node): Leaf[] {
  if (node.kind === "leaf") return [node];
  return [...allLeaves(node.first), ...allLeaves(node.second)];
}

export function leafOf(node: Node, instanceId: string): Leaf | undefined {
  if (node.kind === "leaf") {
    return node.panels.some((panel) => panel.instanceId === instanceId) ? node : undefined;
  }
  return leafOf(node.first, instanceId) ?? leafOf(node.second, instanceId);
}

export function locationOf(state: LayoutState, instanceId: string): PanelLocation | null {
  const { workspace, pinned } = state;
  for (const dock of dockKinds) {
    if (workspace[dock].panels.some((panel) => panel.instanceId === instanceId)) {
      return { region: "dock", dock };
    }
  }
  const leaf = leafOf(workspace.center.root, instanceId);
  if (leaf) return { region: "leaf", leafId: leaf.id };
  if (pinned.widgets.some((widget) => widget.panel.instanceId === instanceId)) {
    return { region: "pinned" };
  }
  return null;
}

export function panelRefOf(state: LayoutState, instanceId: string): PanelRef | undefined {
  const { workspace, pinned } = state;
  for (const dock of dockKinds) {
    const found = workspace[dock].panels.find((panel) => panel.instanceId === instanceId);
    if (found) return found;
  }
  const leaf = leafOf(workspace.center.root, instanceId);
  if (leaf) return leaf.panels.find((panel) => panel.instanceId === instanceId);
  return pinned.widgets.find((widget) => widget.panel.instanceId === instanceId)?.panel;
}

// ---- decode ----

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function decodePanelRef(value: unknown): PanelRef | null {
  if (!isObject(value)) return null;
  const { instanceId, pluginId, panelId } = value;
  if (typeof instanceId !== "string" || instanceId === "") return null;
  if (typeof pluginId !== "string" || pluginId === "") return null;
  if (typeof panelId !== "string" || panelId === "") return null;
  return { instanceId, pluginId, panelId };
}

function decodeStack(value: unknown): Stack | null {
  if (!isObject(value) || !Array.isArray(value.panels)) return null;
  const panels: PanelRef[] = [];
  for (const item of value.panels) {
    const ref = decodePanelRef(item);
    if (!ref) return null;
    panels.push(ref);
  }
  const selected = value.selected;
  if (selected !== null && typeof selected !== "string") return null;
  return { panels, selected: (selected as string | null) ?? null };
}

// leafの形は {kind,id,panels,selected} に限る。余分なキーを持つ
// （旧版のdisplay/columnWidthsなど）入力は丸ごと拒否する（修復しない）。
const leafKeys = ["id", "kind", "panels", "selected"];

function decodeNode(value: unknown): Node | null {
  if (!isObject(value) || typeof value.id !== "string" || value.id === "") return null;
  if (value.kind === "leaf") {
    const keys = Object.keys(value);
    if (keys.length !== leafKeys.length || !leafKeys.every((key) => key in value)) {
      return null;
    }
    const stack = decodeStack({ panels: value.panels, selected: value.selected });
    if (!stack) return null;
    return { kind: "leaf", id: value.id, ...stack };
  }
  if (value.kind === "split") {
    const first = decodeNode(value.first);
    const second = decodeNode(value.second);
    const axis = value.axis === "x" || value.axis === "y" ? value.axis : null;
    const ratio = typeof value.ratio === "number" ? value.ratio : null;
    if (!first || !second || !axis || ratio === null) return null;
    return { kind: "split", id: value.id, axis, ratio, first, second };
  }
  return null;
}

// 形が合わない内容は空として扱う（移行・部分修復はしない）。
export function decodeWorkspace(raw: unknown): WorkspaceState {
  if (!isObject(raw) || raw.version !== 1 || !isObject(raw.center)) {
    return emptyWorkspace();
  }
  const left = decodeStack(raw.left);
  const right = decodeStack(raw.right);
  const bottom = decodeStack(raw.bottom);
  const root = decodeNode(raw.center.root);
  if (!left || !right || !bottom || !root) return emptyWorkspace();
  const focused = raw.center.focusedLeaf;
  const leaves = allLeaves(root);
  const focusedLeaf =
    typeof focused === "string" && leaves.some((leaf) => leaf.id === focused)
      ? focused
      : leaves[0].id;
  return { version: 1, left, right, bottom, center: { root, focusedLeaf } };
}

// widgetの形は {panel}。保存は外部境界なので余分なキーは読み捨て、
// 意味を持つpanelだけを検査する。
function decodeWidget(value: unknown): PinnedWidget | null {
  if (!isObject(value)) return null;
  const panel = decodePanelRef(value.panel);
  return panel ? { panel } : null;
}

export function decodePinned(raw: unknown): PinnedState {
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.widgets)) {
    return emptyPinned();
  }
  const widgets: PinnedWidget[] = [];
  for (const item of raw.widgets) {
    const widget = decodeWidget(item);
    if (!widget) return emptyPinned();
    widgets.push(widget);
  }
  // selectedはwidgets内のinstanceId。無ければ末尾を選んでおく
  // （SigmaOS型なので中身が1つは見えている状態が自然）。
  const selected =
    typeof raw.selected === "string" &&
    widgets.some((widget) => widget.panel.instanceId === raw.selected)
      ? raw.selected
      : (widgets[widgets.length - 1]?.panel.instanceId ?? null);
  return { version: 1, widgets, selected };
}

// ---- 操作 ----

const clone = (state: LayoutState): LayoutState =>
  JSON.parse(JSON.stringify(state)) as LayoutState;

// leafIdのleafが空なら、その親splitを兄弟に置き換えて畳む。rootは畳まない。
// 畳むのは「空になった」leafだけに絞る: splitで作った空leafはdrop先なので、
// 全部の空leafを毎回畳むと分割直後の空leafが消えてdropが失敗する。
function collapseLeaf(node: Node, leafId: string, workspace: WorkspaceState): Node {
  if (node.kind === "leaf") return node;
  const first = collapseLeaf(node.first, leafId, workspace);
  const second = collapseLeaf(node.second, leafId, workspace);
  const dropFirst = first.kind === "leaf" && first.id === leafId && first.panels.length === 0;
  const dropSecond = second.kind === "leaf" && second.id === leafId && second.panels.length === 0;
  if (dropFirst) {
    refocus(workspace, leafId, second);
    return second;
  }
  if (dropSecond) {
    refocus(workspace, leafId, first);
    return first;
  }
  return { ...node, first, second };
}

function refocus(workspace: WorkspaceState, droppedLeafId: string, survivor: Node): void {
  if (workspace.center.focusedLeaf === droppedLeafId) {
    // 消えるleafが焦点を持っていたら、残る側の先頭leafへ。
    workspace.center.focusedLeaf =
      survivor.kind === "leaf" ? survivor.id : allLeaves(survivor)[0].id;
  }
}

// 選択のfallback: 消えたselectedは残りの末尾へ、無ければnull。
function fixSelected(container: Stack | Leaf): void {
  if (container.selected !== null &&
      !container.panels.some((panel) => panel.instanceId === container.selected)) {
    container.selected =
      container.panels.length > 0
        ? container.panels[container.panels.length - 1].instanceId
        : null;
  }
}

// Panelを取り出す。取り出したあとの片付け（split畳み・selected補正）込み。
// pinnedから取り出したときはwidgetも返す（isCrossingが由来領域を
// 判定するのに使う）。
function take(
  state: LayoutState,
  instanceId: string,
): { ref: PanelRef; widget?: PinnedWidget } | undefined {
  const { workspace, pinned } = state;
  for (const stack of dockKinds.map((dock) => workspace[dock])) {
    const index = stack.panels.findIndex((panel) => panel.instanceId === instanceId);
    if (index >= 0) {
      const [ref] = stack.panels.splice(index, 1);
      fixSelected(stack);
      return { ref };
    }
  }
  const widgetIndex = pinned.widgets.findIndex(
    (widget) => widget.panel.instanceId === instanceId,
  );
  if (widgetIndex >= 0) {
    const [widget] = pinned.widgets.splice(widgetIndex, 1);
    // selectedが消えたら末尾へ（Stackと同じfallback）。
    if (pinned.selected === instanceId) {
      pinned.selected =
        pinned.widgets.length > 0
          ? pinned.widgets[pinned.widgets.length - 1].panel.instanceId
          : null;
    }
    return { ref: widget.panel, widget };
  }
  const leaf = leafOf(workspace.center.root, instanceId);
  if (leaf) {
    const index = leaf.panels.findIndex((panel) => panel.instanceId === instanceId);
    const [ref] = leaf.panels.splice(index, 1);
    fixSelected(leaf);
    workspace.center.root = collapseLeaf(workspace.center.root, leaf.id, workspace);
    return { ref };
  }
  return undefined;
}

// panelとwidgetは相互変換しない。既存Instanceがpinned⇔workspaceを
// またぐtargetは変換を意味するので、操作自体を捨てる。
const isCrossing = (taken: { widget?: PinnedWidget }, target: MoveTarget): boolean =>
  (target.region === "pinned") !== (taken.widget !== undefined);

export function addPanel(state: LayoutState, ref: PanelRef, target?: MoveTarget): LayoutState {
  const next = clone(state);
  const effective: MoveTarget =
    target ?? { region: "leaf", leafId: next.workspace.center.focusedLeaf, index: -1 };
  // 既にどこかにある同じinstanceIdは移動として扱う（不変条件を守る）。
  const taken = take(next, ref.instanceId);
  if (taken && isCrossing(taken, effective)) return state;
  insert(next, ref, effective, taken?.widget);
  return next;
}

function insert(
  state: LayoutState, ref: PanelRef, target: MoveTarget, widget?: PinnedWidget,
): void {
  const { workspace, pinned } = state;
  switch (target.region) {
    case "dock": {
      const stack = workspace[target.dock];
      stack.panels.splice(at(stack.panels, target.index), 0, ref);
      stack.selected = ref.instanceId;
      return;
    }
    case "pinned": {
      pinned.widgets.splice(at(pinned.widgets, target.index), 0, widget ?? newWidget(ref));
      pinned.selected = ref.instanceId;
      return;
    }
    case "leaf": {
      const leaf = findLeaf(workspace.center.root, target.leafId);
      if (!leaf) return;
      leaf.panels.splice(at(leaf.panels, target.index), 0, ref);
      leaf.selected = ref.instanceId;
      workspace.center.focusedLeaf = leaf.id;
      return;
    }

    case "split": {
      const leaf = findLeaf(workspace.center.root, target.leafId);
      if (!leaf) return;
      const added = splitLeaf(workspace, leaf, target.edge);
      added.panels.push(ref);
      added.selected = ref.instanceId;
      return;
    }
  }
}

// index -1 は末尾。
const at = (list: unknown[], index: number): number =>
  index < 0 ? list.length : Math.min(index, list.length);

// nodeの中でidを持つleaf/splitをotherに置き換える。
function replaceNode(workspace: WorkspaceState, id: string, other: Node): void {
  const replace = (node: Node): Node => {
    if (node.id === id) return other;
    if (node.kind === "split") {
      return { ...node, first: replace(node.first), second: replace(node.second) };
    }
    return node;
  };
  workspace.center.root = replace(workspace.center.root);
}

export function closePanel(state: LayoutState, instanceId: string): LayoutState {
  const next = clone(state);
  take(next, instanceId);
  return next;
}

export function selectPanel(state: LayoutState, instanceId: string): LayoutState {
  const location = locationOf(state, instanceId);
  // pinnedの選択は別物（mainに出すwidget）なのでselectPinned側が持つ。
  if (!location || location.region === "pinned") return state;
  const next = clone(state);
  if (location.region === "dock") {
    next.workspace[location.dock].selected = instanceId;
  } else if (location.region === "leaf") {
    findLeaf(next.workspace.center.root, location.leafId)!.selected = instanceId;
    next.workspace.center.focusedLeaf = location.leafId;
  }
  return next;
}

export function movePanel(state: LayoutState, instanceId: string, target: MoveTarget): LayoutState {
  const next = clone(state);
  const taken = take(next, instanceId);
  if (!taken || isCrossing(taken, target)) return state;
  insert(next, taken.ref, target, taken.widget);
  return next;
}

// pinnedの中身を出すwidgetを選ぶ。widgetsに無いidは捨てる。
export function selectPinned(state: LayoutState, instanceId: string): LayoutState {
  if (!state.pinned.widgets.some((widget) => widget.panel.instanceId === instanceId)) {
    return state;
  }
  if (state.pinned.selected === instanceId) return state;
  const next = clone(state);
  next.pinned.selected = instanceId;
  return next;
}

// leafをedge方向に分割し、新しい（空の）leafをedge側に作って返す。
// 焦点は新しいleafへ移す。
function splitLeaf(workspace: WorkspaceState, leaf: Leaf, edge: Edge): Leaf {
  const added = emptyLeaf();
  const axis = edge === "left" || edge === "right" ? "x" : "y";
  const after = edge === "right" || edge === "bottom";
  const split: Split = {
    kind: "split",
    id: newId("split"),
    axis,
    ratio: 0.5,
    first: after ? leaf : added,
    second: after ? added : leaf,
  };
  replaceNode(workspace, leaf.id, split);
  workspace.center.focusedLeaf = added.id;
  return added;
}

// leafをedge方向に分割する。新しい（空の）leafがedge側に来る。
export function splitAt(state: LayoutState, leafId: string, edge: Edge): LayoutState {
  const next = clone(state);
  const leaf = findLeaf(next.workspace.center.root, leafId);
  if (!leaf) return state;
  splitLeaf(next.workspace, leaf, edge);
  return next;
}

export function setRatio(state: LayoutState, splitId: string, ratio: number): LayoutState {
  const next = clone(state);
  const apply = (node: Node): void => {
    if (node.kind === "split") {
      if (node.id === splitId) node.ratio = Math.min(0.9, Math.max(0.1, ratio));
      apply(node.first);
      apply(node.second);
    }
  };
  apply(next.workspace.center.root);
  return next;
}

export function focusLeaf(state: LayoutState, leafId: string): LayoutState {
  const next = clone(state);
  if (!findLeaf(next.workspace.center.root, leafId)) return state;
  next.workspace.center.focusedLeaf = leafId;
  return next;
}

// 全PanelRefを列挙する（Instanceの生存管理に使う）。
export function allPanelRefs(state: LayoutState): PanelRef[] {
  const { workspace, pinned } = state;
  return [
    ...dockKinds.flatMap((dock) => workspace[dock].panels),
    ...allLeaves(workspace.center.root).flatMap((leaf) => leaf.panels),
    ...pinned.widgets.map((widget) => widget.panel),
  ];
}
