import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addPanel, allLeaves, closePanel,
  decodeWorkspace, emptyWorkspace, findLeaf, locationOf,
  movePanel, selectPanel, setRatio,
  splitAt, type WorkspaceState, type PanelRef,
} from "./model.ts";

const ref = (id: string): PanelRef => ({
  instanceId: id, pluginId: "standard", panelId: "files",
});

const withPanel = (state: WorkspaceState, id: string, target?: Parameters<typeof addPanel>[2]) =>
  addPanel(state, ref(id), target);

describe("decode", () => {
  test("正しい形のWorkspaceをそのまま読める", () => {
    const raw = {
      version: 1,
      left: { panels: [ref("a")], selected: "a" },
      bottom: { panels: [], selected: null },
      side: { panels: [], selected: null },
      center: {
        root: {
          kind: "split", id: "s1", axis: "x", ratio: 0.5,
          first: { kind: "leaf", id: "l1", panels: [], selected: null },
          second: {
            kind: "leaf", id: "l2",
            panels: [ref("b")], selected: "b",
          },
        },
        focusedLeaf: "l2",
      },
    };
    const state = decodeWorkspace(raw);
    assert.equal(state.center.focusedLeaf, "l2");
    assert.equal(state.left.selected, "a");
    assert.equal(allLeaves(state.center.root).length, 2);
  });

  test("形が合わない入力は空のWorkspaceになる", () => {
    for (const raw of [null, undefined, {}, "x", [], { version: 2 },
      { version: 1, left: null }, { version: 1, center: null }]) {
      const state = decodeWorkspace(raw);
      assert.deepEqual(state, emptyWorkspace(), JSON.stringify(raw));
    }
  });

  test("focusedLeafが消えていれば先頭leafにfallbackする", () => {
    const state = decodeWorkspace({
      version: 1,
      left: { panels: [], selected: null },
      bottom: { panels: [], selected: null },
      side: { panels: [], selected: null },
      center: {
        root: {
          kind: "leaf", id: "l1",
          panels: [], selected: null,
        },
        focusedLeaf: "gone",
      },
    });
    assert.equal(state.center.focusedLeaf, "l1");
  });

  test("旧形（rightキー・pinned）は空のWorkspaceになる", () => {
    for (const raw of [
      { version: 1, left: { panels: [], selected: null }, right: { panels: [], selected: null },
        bottom: { panels: [], selected: null },
        center: { root: { kind: "leaf", id: "l1", panels: [], selected: null }, focusedLeaf: "l1" } },
    ]) {
      const state = decodeWorkspace(raw);
      assert.deepEqual(state, emptyWorkspace(), JSON.stringify(raw));
    }
  });
});

describe("add/close", () => {
  test("addはfocusedLeafに入れてselectedにする", () => {
    let state = emptyWorkspace();
    state = withPanel(state, "a");
    const leaf = findLeaf(state.center.root, "leaf-root")!;
    assert.equal(leaf.panels.length, 1);
    assert.equal(leaf.selected, "a");
  });

  test("空のleafはcloseでsplitが畳まれ、rootのleafは空でも残る", () => {
    let state = emptyWorkspace();
    state = splitAt(state, "leaf-root", "right");
    const addedId = state.center.focusedLeaf;
    state = withPanel(state, "a", { region: "leaf", leafId: "leaf-root", index: -1 });
    assert.equal(allLeaves(state.center.root).length, 2);
    // 両方空なのは片方だけ畳まれるのではなく、空leafはcloseしたときだけ畳く。
    // ここでは片方にパネルを入れたので、両方残る。
    // 次に両方消せばrootだけ残る。
    state = closePanel(state, "a");
    // "a"を閉じたleafが空になったのでsplitが畳まれる。
    assert.equal(allLeaves(state.center.root).length, 1);
    assert.equal(state.center.root.kind, "leaf");
    assert.equal(state.center.root.id, addedId);
  });

  test("選択中のPanelを閉じると選択が末尾にfallbackし、無ければnullになる", () => {
    let state = emptyWorkspace();
    state = withPanel(state, "a");
    state = withPanel(state, "b");
    const leaf = findLeaf(state.center.root, "leaf-root")!;
    state = selectPanel(state, "b");
    state = closePanel(state, "b");
    const after = findLeaf(state.center.root, leaf.id)!;
    assert.equal(after.selected, "a");
    state = closePanel(state, "a");
    assert.equal(findLeaf(state.center.root, leaf.id)!.selected, null);
  });
});

describe("move", () => {
  const setup = (): WorkspaceState => {
    let state = emptyWorkspace();
    state = withPanel(state, "a");
    state = withPanel(state, "b");
    state = withPanel(state, "c");
    return state;
  };

  test("leaf内のindex移動", () => {
    let state = setup();
    // a,b,c の順。 c を index 0 へ。
    state = movePanel(state, "c", { region: "leaf", leafId: "leaf-root", index: 0 });
    const leaf = findLeaf(state.center.root, "leaf-root")!;
    assert.deepEqual(leaf.panels.map((p) => p.instanceId), ["c", "a", "b"]);
  });

  test("dock→leafの移動", () => {
    let state = emptyWorkspace();
    state = withPanel(state, "a", { region: "dock", dock: "left", index: -1 });
    assert.equal(locationOf(state, "a")?.region, "dock");
    state = movePanel(state, "a", { region: "leaf", leafId: "leaf-root", index: -1 });
    assert.equal(state.left.panels.length, 0);
    assert.equal(findLeaf(state.center.root, "leaf-root")!.panels.length, 1);
  });

  test("leaf→sideの移動（領域の違いだけでpanelは同じ）", () => {
    let state = setup();
    state = movePanel(state, "a", { region: "dock", dock: "side", index: -1 });
    assert.equal(state.side.panels.length, 1);
    assert.equal(state.side.selected, "a");
    assert.equal(locationOf(state, "a")?.region, "dock");
  });

  test("side→leafの移動", () => {
    let state = emptyWorkspace();
    state = withPanel(state, "a", { region: "dock", dock: "side", index: -1 });
    state = movePanel(state, "a",
      { region: "leaf", leafId: state.center.focusedLeaf, index: -1 });
    assert.equal(state.side.panels.length, 0);
    assert.equal(locationOf(state, "a")?.region, "leaf");
  });

  test("split targetはleafのedge側に新しいleafを作る", () => {
    let state = setup();
    state = movePanel(state, "a", { region: "split", leafId: "leaf-root", edge: "right" });
    const root = state.center.root;
    assert.equal(root.kind, "split");
    if (root.kind !== "split") return;
    assert.equal(root.axis, "x");
    assert.equal(root.first.id, "leaf-root");
    assert.deepEqual(
      (root.second.kind === "leaf" ? root.second.panels : []).map((p) => p.instanceId),
      ["a"],
    );
    // 移動先のleafがfocusedLeafになる。
    assert.equal(state.center.focusedLeaf, root.second.id);
  });

  test("同じinstanceIdをaddすると二重に置かれない", () => {
    let state = setup();
    state = withPanel(state, "a", { region: "dock", dock: "bottom", index: -1 });
    assert.equal(state.bottom.panels.length, 1);
    assert.equal(findLeaf(state.center.root, "leaf-root")!.panels.length, 2);
  });
});

describe("split", () => {
  test("splitAtは全edgeに対応し、axisと向きが正しい", () => {
    for (const [edge, axis, firstId] of [
      ["left", "x", "new"], ["right", "x", "leaf-root"],
      ["top", "y", "new"], ["bottom", "y", "leaf-root"],
    ] as const) {
      let state = emptyWorkspace();
      state = splitAt(state, "leaf-root", edge);
      const root = state.center.root;
      assert.equal(root.kind, "split", edge);
      if (root.kind !== "split") return;
      assert.equal(root.axis, axis, edge);
      assert.equal(root.first.id, firstId === "new" ? state.center.focusedLeaf : firstId);
    }
  });

  test("setRatioは0.1〜0.9にclampする", () => {
    let state = emptyWorkspace();
    state = splitAt(state, "leaf-root", "right");
    const root = state.center.root;
    if (root.kind !== "split") throw new Error("split expected");
    state = setRatio(state, root.id, 0.02);
    assert.equal((state.center.root as typeof root).ratio, 0.1);
    state = setRatio(state, root.id, 1.5);
    assert.equal((state.center.root as typeof root).ratio, 0.9);
  });

  test("畳まれたleafがfocusを持っていたら兄弟に移る", () => {
    let state = emptyWorkspace();
    state = splitAt(state, "leaf-root", "right");
    const addedId = state.center.focusedLeaf;
    state = withPanel(state, "a", { region: "leaf", leafId: addedId, index: -1 });
    state = closePanel(state, "a");
    assert.equal(state.center.focusedLeaf, "leaf-root");
    assert.equal(state.center.root.id, "leaf-root");
  });
});

describe("leafのdecodeの厳密さ", () => {
  const raw = (leaf: Record<string, unknown>) => ({
    version: 1,
    left: { panels: [], selected: null },
    bottom: { panels: [], selected: null },
    side: { panels: [], selected: null },
    center: { root: leaf, focusedLeaf: "l1" },
  });
  const leaf = { kind: "leaf", id: "l1", panels: [ref("x")], selected: "x" };

  test("{kind,id,panels,selected}のleafを読める", () => {
    const state = decodeWorkspace(raw(leaf));
    assert.equal(state.center.focusedLeaf, "l1");
    assert.equal(allLeaves(state.center.root)[0].panels.length, 1);
  });

  test("余分なキー（旧display/columnWidths等）があると空のWorkspaceになる", () => {
    for (const extra of [{ display: "tabs" }, { columnWidths: { x: 0.5 } }]) {
      const state = decodeWorkspace(raw({ ...leaf, ...extra }));
      assert.equal((state.center.root as { panels: unknown[] }).panels.length, 0);
    }
  });

  test("必須キーが欠けていても空のWorkspaceになる", () => {
    const { selected: _, ...noSelected } = leaf;
    const state = decodeWorkspace(raw(noSelected));
    assert.equal((state.center.root as { panels: unknown[] }).panels.length, 0);
  });
});
