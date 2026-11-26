import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "@solidjs/vite-plugin";

// ビルド成果物のmanifest（plugumi-ui.json）を生成する。
// mainプロセス側はこれを読み、filesをCoreへpushしてmanifestを登録する。
// filesはdist内の全ファイル（このmanifest自身と.gitkeepは除く）。
function uiManifest(): Plugin {
  let outDir = "dist";
  return {
    name: "plugumi-ui-manifest",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files: { path: string; sha256: string }[] = [];
      const walk = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const full = join(directory, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          const path = relative(outDir, full).split(sep).join("/");
          if (path === "plugumi-ui.json" || path === ".gitkeep") continue;
          files.push({
            path,
            sha256: createHash("sha256").update(readFileSync(full)).digest("hex"),
          });
        }
      };
      walk(outDir);
      files.sort((a, b) => a.path.localeCompare(b.path));
      const panels = [
        { panelId: "site", title: "Site", entry: "site.js", styles: ["site.css"] },
      ];
      writeFileSync(join(outDir, "plugumi-ui.json"), JSON.stringify({ files, panels }) + "\n");
    },
  };
}

export default defineConfig({
  plugins: [solid(), uiManifest()],
  build: {
    // mount(host, context)をexportするESM 1ファイルにまとめる。
    // CSSはsite.cssとして分けて出し、manifestのstylesで宣言する
    // （Clientがentryより先に読み、自分の登録のscope内に限定して適用する）。
    lib: {
      entry: { site: "src/site-entry.tsx" },
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: "site",
    },
    outDir: "dist",
  },
});
