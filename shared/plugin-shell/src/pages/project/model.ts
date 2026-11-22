import type { Dock, PanelRef, WsLeaf, WsNode } from "../../host";

export type DockKind = "left" | "center" | "right" | "bottom";
export type WsDisplay = "tabs" | "scroll" | "pages";

export interface DockData {
  panels: PanelRef[];
  selected: string;
  // shelfのみ: instanceIdごとの積層section状態。
  sections?: Record<string, { collapsed?: boolean; grow?: number }>;
}

// Workspace(center)は1本のsplit treeを持つ。leafは中身のPanel群を
// display（tabs=tab stack / scroll=横並び列）で見せる。
// panels/selectedはcanonicalなフラット集合（wire互換ビュー）。
export interface WsCenter {
  panels: PanelRef[];
  selected: string;
  layout: WsNode;
}

export interface LayoutDocks {
  left: DockData;
  center: WsCenter;
  right: DockData;
  bottom: DockData;
}

// layout.ws["ws:a/b"] = Workspace(3 dock + center tree)、
// layout.shelf = Project単位の積層region。cross-regionのdetach/挿入を
// produceの単一draftで原子的に行うため、両方を同じstoreに置く。
export interface ShellLayout {
  ws: Record<string, LayoutDocks>;
  shelf: DockData;
}

export const newAreaId = () => `wa-${crypto.randomUUID().slice(0, 8)}`;
export const emptyWsLeaf = (display: WsDisplay = "tabs"): WsLeaf =>
  ({ kind: "leaf", id: newAreaId(), panels: [], selected: "", display });

export const toWsCenter = (dock: Dock): WsCenter => {
  const center: WsCenter = {
    panels: dock.panels ?? [],
    selected: dock.selected,
    layout: dock.layout ?? { ...emptyWsLeaf("tabs"), panels: [...(dock.panels ?? [])], selected: dock.selected },
  };
  // 永続化データのdrift対策: flatなpanelsがcanonical。treeに欠けた
  // refはlast leafへ足し、panelsに無いrefはtreeから落とす。
  const known = new Set(center.panels.map((panel) => panel.instanceId));
  if (center.selected !== "" && !known.has(center.selected)) {
    center.selected = center.panels.at(-1)?.instanceId ?? "";
  }
  const inTree = new Set<string>();
  for (const leaf of wsLeaves(center.layout)) {
    leaf.panels = (leaf.panels ?? []).filter((panel) => known.has(panel.instanceId));
    if (!leaf.panels.some((panel) => panel.instanceId === leaf.selected)) {
      leaf.selected = leaf.panels.at(-1)?.instanceId ?? "";
    }
    leaf.display ??= "tabs";
    for (const panel of leaf.panels) inTree.add(panel.instanceId);
  }
  const missing = center.panels.filter((panel) => !inTree.has(panel.instanceId));
  if (missing.length > 0) {
    const last = lastWsLeaf(center.layout);
    last.panels.push(...missing);
    if (last.selected === "") {
      last.selected = missing.some((panel) => panel.instanceId === center.selected)
        ? center.selected
        : missing[0].instanceId;
    }
  }
  center.layout = wsCollapseEmpty(center.layout) ?? emptyWsLeaf("tabs");
  return center;
};

// ---- tree操作（leaf探索・leafの除去縮約・split挿入） ----

export const wsLeaves = (node: WsNode): WsLeaf[] =>
  node.kind === "leaf" ? [node] : [...wsLeaves(node.first), ...wsLeaves(node.second)];
export const lastWsLeaf = (node: WsNode): WsLeaf =>
  node.kind === "leaf" ? node : lastWsLeaf(node.second);

export const wsLeafOf = (node: WsNode, instanceId: string) =>
  wsLeaves(node).find((leaf) => leaf.panels.some((panel) => panel.instanceId === instanceId));

// Panelをleafから外す。leafが空になったらsplitごと縮約し、兄弟を昇格させる。
export const wsRemove = (node: WsNode, instanceId: string): WsNode | null => {
  if (node.kind === "leaf") {
    node.panels = node.panels.filter((panel) => panel.instanceId !== instanceId);
    if (node.selected === instanceId) node.selected = node.panels.at(-1)?.instanceId ?? "";
    return node.panels.length > 0 ? node : null;
  }
  const first = wsRemove(node.first, instanceId);
  const second = wsRemove(node.second, instanceId);
  if (first === null) return second;
  if (second === null) return first;
  node.first = first;
  node.second = second;
  return node;
};

// 空leafをsplitから取り除く（root leafは残すため結果nullは呼び出し側で補う）。
export const wsCollapseEmpty = (node: WsNode): WsNode | null => {
  if (node.kind === "leaf") return node.panels.length > 0 ? node : null;
  const first = wsCollapseEmpty(node.first);
  const second = wsCollapseEmpty(node.second);
  if (first === null) return second;
  if (second === null) return first;
  node.first = first;
  node.second = second;
  return node;
};

export type DropEdge = "left" | "right" | "top" | "bottom";

// target leafをsplitで包み、edge側にnewLeafをぶら下げる。
export const wsSplitAt = (node: WsNode, targetId: string, edge: DropEdge, leaf: WsLeaf): WsNode => {
  if (node.kind === "leaf") {
    if (node.id !== targetId) return node;
    const horizontal = edge === "left" || edge === "right";
    return {
      kind: "split", id: newAreaId(), axis: horizontal ? "x" : "y", ratio: 0.5,
      first: edge === "left" || edge === "top" ? leaf : node,
      second: edge === "left" || edge === "top" ? node : leaf,
    };
  }
  node.first = wsSplitAt(node.first, targetId, edge, leaf);
  node.second = wsSplitAt(node.second, targetId, edge, leaf);
  return node;
};

// split nodeのratioを更新する。
export const wsSetRatio = (node: WsNode, id: string, ratio: number) => {
  if (node.kind !== "split") return;
  if (node.id === id) {
    node.ratio = Math.min(0.9, Math.max(0.1, ratio));
    return;
  }
  wsSetRatio(node.first, id, ratio);
  wsSetRatio(node.second, id, ratio);
};

// Workspaceのキー。shelfはProject単位でArea切替に左右されない。
export const SHELF = "shelf";
export const wsKey = (path: string[]) => (path.length === 0 ? "" : `ws:${path.join("/")}`);
