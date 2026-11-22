// localStorage が使えない環境（プライベートモード等）でも落ちないよう包む。

export function loadLastLocation(coreKey: string): string {
  try {
    return localStorage.getItem(`plugumi:last-location:${coreKey}`) ?? "";
  } catch {
    return "";
  }
}

export function saveLastLocation(coreKey: string, path: string): void {
  try {
    localStorage.setItem(`plugumi:last-location:${coreKey}`, path);
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function loadSideOpen(): boolean {
  try {
    return localStorage.getItem("plugumi:ui:side-open") !== "0";
  } catch {
    return true;
  }
}

export function saveSideOpen(open: boolean): void {
  try {
    localStorage.setItem("plugumi:ui:side-open", open ? "1" : "0");
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function loadPinnedOpen(): boolean {
  try {
    return localStorage.getItem("plugumi:ui:pinned-open") !== "0";
  } catch {
    return true;
  }
}

export type ThemeMode = "system" | "light" | "dark";

export function loadTheme(): ThemeMode {
  try {
    const value = localStorage.getItem("plugumi:ui:theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem("plugumi:ui:theme", mode);
  } catch {
    // 保存できなくても画面は動かす
  }
}

export function savePinnedOpen(open: boolean): void {
  try {
    localStorage.setItem("plugumi:ui:pinned-open", open ? "1" : "0");
  } catch {
    // 保存できなくても画面は動かす
  }
}
