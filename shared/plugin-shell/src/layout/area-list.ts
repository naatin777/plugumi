// Area list（左の列）の保存モデルと純粋な操作群。
// Main/Sub/Floatingの3リストにAreaへの参照を並べる。SolidやDOMには触れない。
// プロトタイプの保存先はlocalStorageで、壊れた形は空として扱う（移行しない）。

export type AreaRef = {
  project: string;
  path: string[];
};

export type AreaDisplay = "full" | "center";

export type AreaEntry = {
  area: AreaRef;
  display: AreaDisplay;
};

export type ListSlot = "main" | "sub" | "floating";

export type AreaListState = {
  version: 1;
  main: AreaEntry[];
  sub: AreaEntry[];
  floating: AreaEntry[];
  // 選択中はslotごとにareaKeyで持つ。
  selected: { main: string | null; sub: string | null };
};

// projectとpathから一意な文字列を作る。区切りはencodeURIComponentで
// 潰れるので、各segmentを個別にencodeして「/」で継ぐ。
export const areaKey = (ref: AreaRef): string =>
  `${encodeURIComponent(ref.project)}/${ref.path.map(encodeURIComponent).join("/")}`;

export const emptyAreaList = (): AreaListState => ({
  version: 1,
  main: [],
  sub: [],
  floating: [],
  selected: { main: null, sub: null },
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function decodeAreaRef(value: unknown): AreaRef | null {
  if (!isObject(value)) return null;
  const { project, path } = value;
  if (typeof project !== "string" || project === "") return null;
  if (!Array.isArray(path) || path.some((part) => typeof part !== "string")) return null;
  return { project, path: path as string[] };
}

function decodeEntry(value: unknown): AreaEntry | null {
  if (!isObject(value)) return null;
  const area = decodeAreaRef(value.area);
  if (!area) return null;
  const display = value.display === "center" ? "center" : value.display === "full" ? "full" : null;
  if (!display) return null;
  return { area, display };
}

function decodeSlot(value: unknown): AreaEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: AreaEntry[] = [];
  for (const item of value) {
    const entry = decodeEntry(item);
    if (!entry) return null;
    entries.push(entry);
  }
  return entries;
}

const keyIn = (entries: AreaEntry[], key: string): boolean =>
  entries.some((entry) => areaKey(entry.area) === key);

// 形が合わない内容は空として扱う。selectedはlistに無いkeyならnullへ落とす。
export function decodeAreaList(raw: unknown): AreaListState {
  if (!isObject(raw) || raw.version !== 1) return emptyAreaList();
  const main = decodeSlot(raw.main);
  const sub = decodeSlot(raw.sub);
  const floating = decodeSlot(raw.floating);
  if (!main || !sub || !floating) return emptyAreaList();
  const selected = isObject(raw.selected) ? raw.selected : {};
  const pick = (entries: AreaEntry[], value: unknown): string | null =>
    typeof value === "string" && keyIn(entries, value) ? value : null;
  return {
    version: 1,
    main, sub, floating,
    selected: { main: pick(main, selected.main), sub: pick(sub, selected.sub) },
  };
}

// ---- 操作 ----

const clone = (state: AreaListState): AreaListState =>
  JSON.parse(JSON.stringify(state)) as AreaListState;

// 同slot内の重複は足さず選択だけ行う。main/subへ足したときは選択する。
export function addArea(state: AreaListState, slot: ListSlot, ref: AreaRef): AreaListState {
  const key = areaKey(ref);
  const next = clone(state);
  if (!keyIn(next[slot], key)) {
    next[slot].push({ area: ref, display: "full" });
  }
  if (slot === "main" || slot === "sub") next.selected[slot] = key;
  return next;
}

// 選択中を外したら末尾へfallback、無ければnull。
export function removeArea(state: AreaListState, slot: ListSlot, key: string): AreaListState {
  const next = clone(state);
  next[slot] = next[slot].filter((entry) => areaKey(entry.area) !== key);
  if (slot === "main" || slot === "sub") {
    if (next.selected[slot] === key) {
      const last = next[slot][next[slot].length - 1];
      next.selected[slot] = last ? areaKey(last.area) : null;
    }
  }
  return next;
}

// displayを保ったまま別slotへ移す。移動先がmain/subなら選択する。
export function moveArea(
  state: AreaListState, from: ListSlot, key: string, to: ListSlot,
): AreaListState {
  const entry = state[from].find((item) => areaKey(item.area) === key);
  if (!entry || from === to) return state;
  const next = removeArea(state, from, key);
  if (!keyIn(next[to], key)) {
    next[to].push({ area: entry.area, display: entry.display });
  }
  if (to === "main" || to === "sub") next.selected[to] = key;
  return next;
}

export function selectArea(state: AreaListState, slot: ListSlot, key: string): AreaListState {
  if (slot !== "main" && slot !== "sub") return state;
  if (!keyIn(state[slot], key)) return state;
  if (state.selected[slot] === key) return state;
  const next = clone(state);
  next.selected[slot] = key;
  return next;
}

export function setDisplay(
  state: AreaListState, slot: ListSlot, key: string, display: AreaDisplay,
): AreaListState {
  const entry = state[slot].find((item) => areaKey(item.area) === key);
  if (!entry || entry.display === display) return state;
  const next = clone(state);
  next[slot].find((item) => areaKey(item.area) === key)!.display = display;
  return next;
}

// ---- 保存（localStorage。prefsと同じく読み書きはtry/catchで包む） ----

const KEY = (coreKey: string) => `plugumi:shell:areas:${coreKey}`;

export function loadAreaList(coreKey: string): AreaListState {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY(coreKey)) ?? "null");
  } catch {
    return emptyAreaList();
  }
  return decodeAreaList(raw);
}

export function saveAreaList(coreKey: string, state: AreaListState): void {
  try {
    localStorage.setItem(KEY(coreKey), JSON.stringify(state));
  } catch {
    // 保存できなくても画面は動かす
  }
}
