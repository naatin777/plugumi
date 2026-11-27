// filesystem environment provider。UIは持たない（headless — Decision 00017）。
// root配下のpathに閉じ込め、list/read/writeを提供する。
// rootは --root か PLUGUMI_FS_ROOT、既定はprocessのcwd。
import { readdir, readFile, writeFile, stat, mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import { PluginRuntime, coreURL } from "@plugumi/runtime";
import type { RuntimeMessage, ViewMessage } from "./shared.js";

const arg = (name: string): string | undefined =>
  process.argv.find((_, index) => process.argv[index - 1] === `--${name}`);

const coreArg = arg("core");
const url = coreURL(coreArg ?? process.env.PLUGUMI_CORE_URL ?? "http://127.0.0.1:3500");
const root = path.resolve(arg("root") ?? process.env.PLUGUMI_FS_ROOT ?? process.cwd());

// rootの外へ出るpath（..の連なりやsymlink逃げ、absolute）は拒否する。
// symlinkの実体までは追わない — lexicalな閉じ込め（v1の線）。
const confined = (input: unknown): string => {
  const rel = typeof input === "string" ? input : ".";
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path escapes root: ${rel}`);
  }
  return resolved;
};

const pathOf = (input: unknown): string => {
  const value = (input as { path?: unknown })?.path;
  return confined(typeof value === "string" ? value : ".");
};

interface Entry {
  name: string;
  kind: string;
  size: number;
}

const list = async (input: unknown) => {
  const dir = pathOf(input);
  const names = await readdir(dir);
  const entries: Entry[] = [];
  for (const name of names) {
    try {
      const info = await stat(path.join(dir, name));
      entries.push({
        name,
        kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
        size: info.size,
      });
    } catch {
      // 読めないentry（broken symlink等）はotherとして出す
      entries.push({ name, kind: "other", size: 0 });
    }
  }
  // directoryを先に、あとは名前順
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
  return { entries };
};

// 大きすぎるfileやbinaryは読まない。editorが扱うのはtextなので、
// UTF-8で読めない・制御文字だらけのものはbinaryとして拒否する。
const READ_LIMIT = 2 * 1024 * 1024;
const read = async (input: unknown) => {
  const file = pathOf(input);
  const info = await stat(file);
  if (info.size > READ_LIMIT) {
    throw new Error(`file too large: ${info.size} bytes (limit ${READ_LIMIT})`);
  }
  const content = await readFile(file, "utf8");
  // NULを含むものはbinaryとみなす
  if (content.includes("")) {
    throw new Error("binary file");
  }
  return { content, size: info.size };
};

const write = async (input: unknown) => {
  const body = input as { path?: unknown; content?: unknown };
  if (typeof body?.content !== "string") throw new Error("content is required");
  const file = pathOf(body);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body.content, "utf8");
  return { ok: true };
};

const remove = async (input: unknown) => {
  await rm(pathOf(input), { recursive: true });
  return { ok: true };
};

const move = async (input: unknown) => {
  const body = input as { path?: unknown; to?: unknown };
  if (typeof body?.to !== "string") throw new Error("to is required");
  await rename(pathOf(body), confined(body.to));
  return { ok: true };
};

const runtime = new PluginRuntime({
  url,
  providerId: "filesystem",
  instanceId: `filesystem-${process.pid}`,
  operations: [
    { path: "filesystem/list", description: "list directory entries", handle: list },
    { path: "filesystem/read", description: "read a text file", handle: read },
    { path: "filesystem/write", description: "write a text file", handle: write },
    { path: "filesystem/remove", description: "remove a file or directory", handle: remove },
    { path: "filesystem/move", description: "move/rename a file or directory", handle: move },
  ],
  ui: {
    root: new URL("../dist-ui", import.meta.url).pathname,
    panels: [{ panelId: "editor", title: "Editor", entry: "editor.js" }],
  },
  // editor viewからのread/write。operationと同じfs関数に流す —
  // channel経由だからといって別実装は置かない。
  onView(channel) {
    const typed = channel.typed<RuntimeMessage, ViewMessage>();
    typed.onMessage(async (message) => {
      try {
        if (message.type === "read") {
          const result = await read({ path: message.path });
          typed.send({ type: "content", path: message.path, content: result.content });
        }
        if (message.type === "write") {
          await write({ path: message.path, content: message.content });
          typed.send({ type: "saved", path: message.path });
        }
      } catch (cause) {
        typed.send({ type: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    });
  },
  log: (message) => console.log(`[filesystem] ${message}`),
});

console.log(`[filesystem] root: ${root}`);
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
await runtime.run(controller.signal);
