// 端末ごとの表示設定。Workspaceの保存とは分け、1つのlocalStorageキーに
// まとめる（designs/00005「開閉・幅・テーマなど端末ごとの表示設定」）。
// localStorageが使えない環境でも落ちないよう、読み書きはtry/catchで包む。
import type { DockKind } from "./layout/model.ts";

export type ThemeMode = "system" | "light" | "dark";

export interface ShellPrefs {
  sidebarOpen: boolean;
  pinnedOpen: boolean;
  dockOpen: Record<DockKind, boolean>;
  // dockの幅/高さ（px）。bottomは高さ。
  dockSize: Record<DockKind, number>;
  sidebarWidth: number;
  pinnedWidth: number;
  // 左右のframe領域（sidebar＋pinned）をまとめて畳む。
  // 個別の開閉状態は潰さないので、戻すと元の開き方に復帰する。
  sideHidden: boolean;
  theme: ThemeMode;
  // 床の虹色もやもや。消すとフラットな暗い床になる。
  aurora: boolean;
}

const KEY = "plugumi:shell:prefs";

const defaults = (): ShellPrefs => ({
  sidebarOpen: true,
  pinnedOpen: true,
  dockOpen: { left: true, bottom: true, right: true },
  dockSize: { left: 280, bottom: 200, right: 280 },
  // --title-tools-left（260px）以上にしておき、既定のwork面は矩形になる。
  sidebarWidth: 260,
  pinnedWidth: 280,
  sideHidden: false,
  theme: "system",
  aurora: true,
});

const clampWidth = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(640, Math.max(80, value))
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
  const dockSize = typeof saved.dockSize === "object" && saved.dockSize !== null
    ? saved.dockSize as Record<string, unknown>
    : {};
  const theme = saved.theme;
  return {
    sidebarOpen: flag(saved.sidebarOpen, base.sidebarOpen),
    pinnedOpen: flag(saved.pinnedOpen, base.pinnedOpen),
    dockOpen: {
      left: flag(dockOpen.left, base.dockOpen.left),
      bottom: flag(dockOpen.bottom, base.dockOpen.bottom),
      right: flag(dockOpen.right, base.dockOpen.right),
    },
    dockSize: {
      left: clampWidth(dockSize.left, base.dockSize.left),
      bottom: clampWidth(dockSize.bottom, base.dockSize.bottom),
      right: clampWidth(dockSize.right, base.dockSize.right),
    },
    sidebarWidth: clampWidth(saved.sidebarWidth, base.sidebarWidth),
    pinnedWidth: clampWidth(saved.pinnedWidth, base.pinnedWidth),
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
