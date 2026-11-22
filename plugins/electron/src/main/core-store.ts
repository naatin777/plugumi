// UIから追加したCoreの永続化。web pluginのcores.Storeと同じく
// {"cores":[url,...]} のJSON。保存先は<appData>/plugumi/electron.json
// （<name>.jsonのProject保存と混ざらないようappData側に置く）。
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

export class CoreStore {
  constructor(private readonly path: string) {}

  load(): string[] {
    let data: string;
    try {
      data = readFileSync(this.path, "utf8");
    } catch {
      return [];
    }
    const saved = JSON.parse(data) as { cores?: unknown };
    return Array.isArray(saved.cores)
      ? saved.cores.filter((entry): entry is string => typeof entry === "string")
      : [];
  }

  add(url: string): void {
    this.update((urls) => (urls.includes(url) ? urls : [...urls, url]));
  }

  remove(url: string): void {
    this.update((urls) => urls.filter((entry) => entry !== url));
  }

  private update(change: (urls: string[]) => string[]): void {
    const urls = change(this.load());
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = join(dirname(this.path), `.tmp-${process.pid}`);
    writeFileSync(temporary, JSON.stringify({ cores: urls }) + "\n", { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}
