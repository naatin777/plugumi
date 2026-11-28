// Area list（左の列）の保存モデルと純粋な操作群。
// 表示するAreaは常に「今のProjectの全Area」から導出する（隠しAreaは
// 作らない）。保存するのは差分だけ: Sub・Detachに移したAreaと表示形式。
// 保存先はlocalStorageで、壊れた形は空として扱う（移行しない）。

export type AreaRef = {
  project: string;
  path: string[];
};

export type ListSlot = "main" | "sub" | "detach";

export type AreaListState = {
  version: 1;
  // SubセクションにいるAreaのpath key（並び順）。
  sub: string[];
  // Subに表示中のAreaのpath key。
  selectedSub: string | null;
  // DetachセクションにいるAreaのpath key（並び順）= 「別windowに出す」
  // と印を付けたArea。windowの開閉は保存しない — 閉じていても残り、
  // 行のclickで開き直す。
  detached: string[];
};

// hostのAreaTreeと構造が同じ最小の形（hostへ依存しないようここで宣言）。
// pathに入るのはkey（URL segment）。titleは表示用で同一性には使わない。
export interface AreaNode {
  key: string;
  title: string;
  areas: AreaNode[];
}

// Area pathから一意な文字列を作る。区切りはencodeURIComponentで
// 潰れるので、各segmentを個別にencodeして「/」で継ぐ。
export const pathKey = (path: string[]): string =>
  path.map(encodeURIComponent).join("/");

export const pathFromKey = (key: string): string[] =>
  key.split("/").filter(Boolean).map(decodeURIComponent);

// projectまで含めたAreaの同一性比較用（subのキーはpathKey）。
export const areaKey = (ref: AreaRef): string =>
  `${encodeURIComponent(ref.project)}/${pathKey(ref.path)}`;

export const emptyAreaList = (): AreaListState => ({
  version: 1,
  sub: [],
  selectedSub: null,
  detached: [],
});

// ---- 導出（保存しない） ----

export type FlatArea = {
  path: string[];
  depth: number;
  title: string;
};

// treeをDFSで平坦化する（tree順＝親→子の順）。pathはkeyの列。
export function flattenAreas(areas: AreaNode[]): FlatArea[] {
  const out: FlatArea[] = [];
  const walk = (nodes: AreaNode[], path: string[]) => {
    for (const node of nodes) {
      const next = [...path, node.key];
      out.push({ path: next, depth: path.length, title: node.title });
      walk(node.areas, next);
    }
  };
  walk(areas, []);
  return out;
}

// Mainセクション = 全Areaのうちsubにもdetachedにも無いもの（tree順）。
export function mainAreas(state: AreaListState, areas: AreaNode[]): FlatArea[] {
  const placed = new Set([...state.sub, ...state.detached]);
  return flattenAreas(areas).filter((area) => !placed.has(pathKey(area.path)));
}

// Subセクション = subの順で、treeに実在するものだけ（消えたAreaのkeyは
// 表示から外すだけ — 保存は掃除しない）。Detachも同じ規則。
const placedAreas = (placed: string[], areas: AreaNode[]): FlatArea[] => {
  const byKey = new Map(flattenAreas(areas).map((area) => [pathKey(area.path), area]));
  return placed
    .map((key) => byKey.get(key))
    .filter((area): area is FlatArea => area !== undefined)
    .map((area) => ({ ...area, depth: 0 }));
};

export function subAreas(state: AreaListState, areas: AreaNode[]): FlatArea[] {
  return placedAreas(state.sub, areas);
}

export function detachedAreas(state: AreaListState, areas: AreaNode[]): FlatArea[] {
  return placedAreas(state.detached, areas);
}

// ---- 操作 ----

const clone = (state: AreaListState): AreaListState =>
  JSON.parse(JSON.stringify(state)) as AreaListState;

// 配置はMain/Sub/Detachで排他 — 移動は他slotから外すことも含む。

// Subへ移す（末尾へ。選択もする）。既にsubにあれば選択だけ行う。
export function toSub(state: AreaListState, key: string): AreaListState {
  const next = clone(state);
  next.detached = next.detached.filter((item) => item !== key);
  if (!next.sub.includes(key)) next.sub.push(key);
  next.selectedSub = key;
  return next;
}

// Detachへ移す（末尾へ）。windowを開くかは呼び側の仕事（Electronのみ）。
export function toDetach(state: AreaListState, key: string): AreaListState {
  const next = clone(state);
  next.sub = next.sub.filter((item) => item !== key);
  if (next.selectedSub === key) {
    next.selectedSub = next.sub[next.sub.length - 1] ?? null;
  }
  if (!next.detached.includes(key)) next.detached.push(key);
  return next;
}

// Mainへ戻す。選択中なら末尾へfallback、無ければnull。
export function toMain(state: AreaListState, key: string): AreaListState {
  if (!state.sub.includes(key) && !state.detached.includes(key)) return state;
  const next = clone(state);
  next.sub = next.sub.filter((item) => item !== key);
  next.detached = next.detached.filter((item) => item !== key);
  if (next.selectedSub === key) {
    next.selectedSub = next.sub[next.sub.length - 1] ?? null;
  }
  return next;
}

export function selectSub(state: AreaListState, key: string): AreaListState {
  if (!state.sub.includes(key) || state.selectedSub === key) return state;
  const next = clone(state);
  next.selectedSub = key;
  return next;
}

// ---- 保存（localStorage。prefsと同じく読み書きはtry/catchで包む） ----

const KEY = (coreKey: string, project: string) =>
  `plugumi:app:area-list:${coreKey}:${project}`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 形が合わない内容は空として扱う。selectedSubはsubに無いkeyならnullへ落とす。
// detachedは後から足した項目なので、無い保存は空配列として読む。
export function decodeAreaList(raw: unknown): AreaListState {
  if (!isObject(raw) || raw.version !== 1) return emptyAreaList();
  if (!Array.isArray(raw.sub) || raw.sub.some((key) => typeof key !== "string")) {
    return emptyAreaList();
  }
  const detached = raw.detached ?? [];
  if (!Array.isArray(detached) || detached.some((key) => typeof key !== "string")) {
    return emptyAreaList();
  }
  const selectedSub = raw.selectedSub;
  return {
    version: 1,
    sub: raw.sub as string[],
    selectedSub: typeof selectedSub === "string" && (raw.sub as string[]).includes(selectedSub)
      ? selectedSub
      : null,
    detached: detached as string[],
  };
}

export function loadAreaList(coreKey: string, project: string): AreaListState {
  let raw: unknown = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY(coreKey, project)) ?? "null");
  } catch {
    return emptyAreaList();
  }
  return decodeAreaList(raw);
}

export function saveAreaList(coreKey: string, project: string, state: AreaListState): void {
  try {
    localStorage.setItem(KEY(coreKey, project), JSON.stringify(state));
  } catch {
    // 保存できなくても画面は動かす
  }
}
