// localStorage が使えない環境（プライベートモード等）でも落ちないよう包む。

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても画面は動かす
  }
};

// "0"/"1"で持つflag。未保存はfallback。
const readFlag = (key: string, fallback: boolean): boolean => {
  const value = read(key);
  return value === null ? fallback : value !== "0";
};

const writeFlag = (key: string, open: boolean): void =>
  write(key, open ? "1" : "0");

export function loadLastLocation(coreKey: string): string {
  return read(`plugumi:last-location:${coreKey}`) ?? "";
}

export function saveLastLocation(coreKey: string, path: string): void {
  write(`plugumi:last-location:${coreKey}`, path);
}

export const loadSideOpen = (): boolean =>
  readFlag("plugumi:ui:side-open", true);
export const saveSideOpen = (open: boolean): void =>
  writeFlag("plugumi:ui:side-open", open);

export const loadShelfOpen = (): boolean =>
  readFlag("plugumi:ui:shelf-open", true);
export const saveShelfOpen = (open: boolean): void =>
  writeFlag("plugumi:ui:shelf-open", open);

export const loadFrameHidden = (): boolean =>
  readFlag("plugumi:ui:frame-hidden", false);
export const saveFrameHidden = (hidden: boolean): void =>
  writeFlag("plugumi:ui:frame-hidden", hidden);

export type ThemeMode = "system" | "light" | "dark";

export function loadTheme(): ThemeMode {
  const value = read("plugumi:ui:theme");
  return value === "light" || value === "dark" ? value : "system";
}

export function saveTheme(mode: ThemeMode): void {
  write("plugumi:ui:theme", mode);
}

export type DockOpen = { left: boolean; bottom: boolean; right: boolean };

export function loadDockOpen(): DockOpen {
  const saved = read("plugumi:ui:dock-open");
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Partial<DockOpen>;
      return {
        left: parsed.left !== false,
        bottom: parsed.bottom !== false,
        right: parsed.right !== false,
      };
    } catch {
      // 壊れたJSONは既定へ戻す
    }
  }
  return { left: true, bottom: true, right: true };
}

export function saveDockOpen(open: DockOpen): void {
  write("plugumi:ui:dock-open", JSON.stringify(open));
}

export type WorkspaceMode = "tabs" | "scroll" | "pages";

// 新規leafの既定display。未設定や旧値はscrollに倒す。
export function loadWorkspaceMode(): WorkspaceMode {
  const mode = read("plugumi:ui:ws-mode");
  return mode === "tabs" || mode === "pages" ? mode : "scroll";
}

export function saveWorkspaceMode(mode: WorkspaceMode): void {
  write("plugumi:ui:ws-mode", mode);
}
