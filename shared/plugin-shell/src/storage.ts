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
