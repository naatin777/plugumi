// Electronが開いたBrowserWindowの管理。Tool（electron/window/*）から
// 参照・操作できるよう、作成したwindowをidで追う。
import type { BrowserWindow } from "electron";

export interface WindowInfo {
  id: number;
  url: string;
  title: string;
  focused: boolean;
}

// openはpath（hostのroute path）を受けてBrowserWindowを返す本体の実装。
export class Windows {
  private readonly windows = new Map<number, BrowserWindow>();

  constructor(private readonly openImpl: (path?: string) => Promise<BrowserWindow>) {}

  async open(path?: string): Promise<number> {
    const window = await this.openImpl(path);
    this.windows.set(window.id, window);
    window.once("closed", () => this.windows.delete(window.id));
    return window.id;
  }

  list(): WindowInfo[] {
    return [...this.windows.values()].map((window) => ({
      id: window.id,
      url: window.webContents.getURL(),
      title: window.getTitle(),
      focused: window.isFocused(),
    }));
  }

  get(id: number): BrowserWindow {
    const window = this.windows.get(id);
    if (!window) throw new Error(`window ${id} は存在しません`);
    return window;
  }
}
