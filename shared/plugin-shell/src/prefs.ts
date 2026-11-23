// 端末ごとの表示設定。Workspaceの保存とは分け、1つのlocalStorageキーに
// まとめる（designs/00005「開閉・幅・テーマなど端末ごとの表示設定」）。
// localStorageが使えない環境でも落ちないよう、読み書きはtry/catchで包む。
import type { DockKind } from "./layout/model.ts";

export type ThemeMode = "system" | "light" | "dark";
// dockの開閉はMain/Subそれぞれの列で独立（title barのボタンも列ごと）。
export type DockSlot = "main" | "sub";

export interface ShellPrefs {
  // Area list（左の列）の開閉と幅。
  sidebarOpen: boolean;
  sidebarWidth: number;
  // Area内のdockの開閉（slotごと）と幅/高さ（px、共通）。bottomは高さ。
  dockOpen: Record<DockSlot, Record<DockKind, boolean>>;
  dockSize: Record<DockKind, number>;
  // Sub列（右のAreaView）の開閉と幅。
  subOpen: boolean;
  subWidth: number;
  // 両端の列（Area list＋Sub）をまとめて畳む。
  // 個別の開閉状態は潰さないので、戻すと元の開き方に復帰する。
  sideHidden: boolean;
  theme: ThemeMode;
  // 床の虹色もやもや。消すとフラットな暗い床になる。
  aurora: boolean;
}

const KEY = "plugumi:shell:prefs";

const defaults = (): ShellPrefs => ({
  sidebarOpen: true,
  sidebarWidth: 260,
  dockOpen: {
    main: { left: true, bottom: true, right: true },
    sub: { left: true, bottom: true, right: true },
  },
  dockSize: { left: 280, bottom: 200, right: 280 },
  subOpen: false,
  subWidth: 480,
  sideHidden: false,
  theme: "system",
  aurora: true,
});

const clampWidth = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(960, Math.max(80, value))
    : fallback;

// 形が合わないフィールドだけ既定に戻す。キー全体が壊れていれば全既定。
export function loadPrefs(): ShellPrefs {
  const base = defaults();
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return base;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return base;
  const saved = raw as Record<string, unknown>;
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;
  const dockOpen = typeof saved.dockOpen === "object" && saved.dockOpen !== null
    ? saved.dockOpen as Record<string, unknown>
    : {};
  // slotごとのRecordをdecode。旧い平たい形（{left,bottom,right}）は
  // slotキーを持たないのでそのまま既定に落ちる（移行しない）。
  const dockSlot = (slot: DockSlot): Record<DockKind, boolean> => {
    const saved_ = typeof dockOpen[slot] === "object" && dockOpen[slot] !== null
      ? dockOpen[slot] as Record<string, unknown>
      : {};
    return {
      left: flag(saved_.left, base.dockOpen[slot].left),
      bottom: flag(saved_.bottom, base.dockOpen[slot].bottom),
      right: flag(saved_.right, base.dockOpen[slot].right),
    };
  };
  const dockSize = typeof saved.dockSize === "object" && saved.dockSize !== null
    ? saved.dockSize as Record<string, unknown>
    : {};
  const theme = saved.theme;
  return {
    sidebarOpen: flag(saved.sidebarOpen, base.sidebarOpen),
    sidebarWidth: clampWidth(saved.sidebarWidth, base.sidebarWidth),
    dockOpen: { main: dockSlot("main"), sub: dockSlot("sub") },
    dockSize: {
      left: clampWidth(dockSize.left, base.dockSize.left),
      bottom: clampWidth(dockSize.bottom, base.dockSize.bottom),
      right: clampWidth(dockSize.right, base.dockSize.right),
    },
    subOpen: flag(saved.subOpen, base.subOpen),
    subWidth: clampWidth(saved.subWidth, base.subWidth),
    sideHidden: flag(saved.sideHidden, base.sideHidden),
    theme: theme === "light" || theme === "dark" || theme === "system" ? theme : base.theme,
    aurora: flag(saved.aurora, base.aurora),
  };
}

export function savePrefs(prefs: ShellPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 保存できなくても画面は動かす
  }
}
