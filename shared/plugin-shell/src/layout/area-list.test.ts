import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  decodeAreaList, emptyAreaList, flattenAreas, mainAreas, pathKey, pathFromKey,
  selectSub, setDisplay, subAreas, toMain, toSub,
  type AreaNode,
} from "./area-list.ts";

const tree: AreaNode[] = [
  { name: "main", areas: [
    { name: "feature-a", areas: [{ name: "jj", areas: [] }] },
    { name: "feature-b", areas: [] },
  ] },
  { name: "other", areas: [] },
];

const paths = (list: { path: string[] }[]) => list.map((item) => pathKey(item.path));

describe("導出", () => {
  test("全Areaをtree順（親→子）で平坦化する", () => {
    assert.deepEqual(paths(flattenAreas(tree)), [
      "main", "main/feature-a", "main/feature-a/jj", "main/feature-b", "other",
    ]);
  });

  test("Mainは全Areaからsubを除いたもの、Subはsubの順で実在分だけ", () => {
    let state = toSub(emptyAreaList(), "other");
    state = toSub(state, "main/feature-a/jj");
    state = { ...state, sub: [...state.sub, "gone/x"] };
    assert.deepEqual(paths(mainAreas(state, tree)), [
      "main", "main/feature-a", "main/feature-b",
    ]);
    // 保存順（other→jj）が保たれ、treeに無いkeyは出ない
    assert.deepEqual(paths(subAreas(state, tree)), ["other", "main/feature-a/jj"]);
  });

  test("keyはsegmentごとにencode/decodeする", () => {
    assert.equal(pathKey(["a/b", "c"]), "a%2Fb/c");
    assert.deepEqual(pathFromKey("a%2Fb/c"), ["a/b", "c"]);
  });
});

describe("操作", () => {
  test("toSubは末尾に足して選択する（重複は選択だけ）", () => {
    let state = toSub(emptyAreaList(), "a");
    state = toSub(state, "b");
    assert.deepEqual(state.sub, ["a", "b"]);
    assert.equal(state.selectedSub, "b");
    state = toSub(state, "a");
    assert.deepEqual(state.sub, ["a", "b"]);
    assert.equal(state.selectedSub, "a");
  });

  test("toMainはsubから外し、選択中なら末尾へfallbackする", () => {
    let state = toSub(emptyAreaList(), "a");
    state = toSub(state, "b");
    assert.deepEqual(toMain(state, "b").selectedSub, "a");
    state = toMain(toMain(state, "b"), "a");
    assert.equal(state.selectedSub, null);
    assert.deepEqual(state.sub, []);
  });

  test("selectSubはsubに無いkeyや現在値では何もしない", () => {
    const state = toSub(emptyAreaList(), "a");
    assert.equal(selectSub(state, "z"), state);
    assert.equal(selectSub(state, "a"), state);
  });

  test("setDisplayはfullを保存しない（差分だけ）", () => {
    let state = setDisplay(emptyAreaList(), "a", "center");
    assert.equal(state.display.a, "center");
    state = setDisplay(state, "a", "full");
    assert.equal("a" in state.display, false);
  });
});

describe("decode", () => {
  test("正しい形をそのまま読める", () => {
    const state = decodeAreaList({
      version: 1,
      sub: ["a", "b"],
      selectedSub: "b",
      display: { a: "center" },
    });
    assert.deepEqual(state.sub, ["a", "b"]);
    assert.equal(state.selectedSub, "b");
  });

  test("壊れた形は空になる", () => {
    for (const raw of [null, undefined, {}, "x", [], { version: 2 },
      { version: 1, sub: "no", selectedSub: null, display: {} },
      { version: 1, sub: [], selectedSub: null, display: { a: "bad" } }]) {
      assert.deepEqual(decodeAreaList(raw), emptyAreaList(), JSON.stringify(raw));
    }
  });

  test("subに無いselectedSubはnullに落とす", () => {
    const state = decodeAreaList({
      version: 1, sub: ["a"], selectedSub: "gone", display: {},
    });
    assert.equal(state.selectedSub, null);
  });
});
