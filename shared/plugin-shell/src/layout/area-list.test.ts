import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addArea, areaKey, decodeAreaList, emptyAreaList, moveArea,
  removeArea, selectArea, setDisplay,
  type AreaRef,
} from "./area-list.ts";

const ref = (project: string, ...path: string[]): AreaRef => ({ project, path });
const aaa = ref("plugumi", "aaa");
const bbb = ref("plugumi", "bbb");
const other = ref("other", "x", "y");

describe("areaKey", () => {
  test("projectとpathから一意な文字列を作る", () => {
    assert.notEqual(areaKey(aaa), areaKey(bbb));
    assert.notEqual(areaKey(ref("p", "a/b")), areaKey(ref("p", "a", "b")));
    assert.equal(areaKey(ref("p")), "p/");
  });
});

describe("add", () => {
  test("mainに追加すると選択される", () => {
    const state = addArea(emptyAreaList(), "main", aaa);
    assert.equal(state.main.length, 1);
    assert.equal(state.main[0].display, "full");
    assert.equal(state.selected.main, areaKey(aaa));
  });

  test("同slotの重複は足されず選択だけになる", () => {
    let state = addArea(emptyAreaList(), "sub", aaa);
    state = addArea(state, "sub", bbb);
    state = selectArea(state, "sub", areaKey(aaa));
    state = addArea(state, "sub", aaa);
    assert.equal(state.sub.length, 2);
    assert.equal(state.selected.sub, areaKey(aaa));
  });

  test("floatingへ足しても選択状態には触れない", () => {
    const state = addArea(emptyAreaList(), "floating", aaa);
    assert.equal(state.floating.length, 1);
    assert.equal(state.selected.main, null);
    assert.equal(state.selected.sub, null);
  });
});

describe("remove", () => {
  test("選択中を外すと末尾へfallbackし、無ければnullになる", () => {
    let state = addArea(emptyAreaList(), "main", aaa);
    state = addArea(state, "main", bbb);
    state = removeArea(state, "main", areaKey(bbb));
    assert.equal(state.selected.main, areaKey(aaa));
    state = removeArea(state, "main", areaKey(aaa));
    assert.equal(state.selected.main, null);
    assert.equal(state.main.length, 0);
  });
});

describe("move", () => {
  test("displayを保ったまま別slotへ移し、main/subなら選択する", () => {
    let state = addArea(emptyAreaList(), "main", aaa);
    state = setDisplay(state, "main", areaKey(aaa), "center");
    state = moveArea(state, "main", areaKey(aaa), "sub");
    assert.equal(state.main.length, 0);
    assert.equal(state.sub.length, 1);
    assert.equal(state.sub[0].display, "center");
    assert.equal(state.selected.sub, areaKey(aaa));
  });

  test("同じslotへの移動は何もしない", () => {
    const state = addArea(emptyAreaList(), "main", aaa);
    assert.equal(moveArea(state, "main", areaKey(aaa), "main"), state);
  });
});

describe("decode", () => {
  test("正しい形をそのまま読める", () => {
    const state = decodeAreaList({
      version: 1,
      main: [{ area: aaa, display: "center" }],
      sub: [],
      floating: [{ area: other, display: "full" }],
      selected: { main: areaKey(aaa), sub: null },
    });
    assert.equal(state.main[0].display, "center");
    assert.equal(state.selected.main, areaKey(aaa));
  });

  test("壊れた形は空になる", () => {
    for (const raw of [null, undefined, {}, "x", [], { version: 2 },
      { version: 1, main: "no", sub: [], floating: [] },
      { version: 1, main: [{ area: { project: 1, path: [] }, display: "full" }], sub: [], floating: [] }]) {
      assert.deepEqual(decodeAreaList(raw), emptyAreaList(), JSON.stringify(raw));
    }
  });

  test("listに無いselectedはnullに落とす", () => {
    const state = decodeAreaList({
      version: 1,
      main: [{ area: aaa, display: "full" }],
      sub: [], floating: [],
      selected: { main: "gone", sub: null },
    });
    assert.equal(state.selected.main, null);
  });
});
