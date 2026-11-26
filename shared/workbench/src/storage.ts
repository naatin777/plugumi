// この端末で最後に開いた場所。localStorageが使えない環境でも落ちないよう包む。
// 端末ごとの表示設定はprefs.tsにまとめ、ここには置かない。

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
