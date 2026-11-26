// E2Eハーネス用のVite設定。rootはtest/harness。fixture（検査用Panelの
// 静的資産）は /fixtures/… をmiddlewareで生のまま配る。publicDirは使わ
// ない — publicDirのファイルは `import(url)` で読めず（Viteが拒否する）、
// Panel mountは動的importなのでmiddlewareが必要。
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "@solidjs/vite-plugin";
import { woff2Only } from "../src/vite.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

const serveFixtures = (): Plugin => ({
  name: "e2e-fixtures",
  configureServer(server) {
    server.middlewares.use("/fixtures", (req, res) => {
      const pathname = decodeURIComponent((req.url ?? "").split("?")[0]);
      const file = resolve(FIXTURES, `.${sep}${pathname}`);
      if (!file.startsWith(FIXTURES) || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const ext = file.slice(file.lastIndexOf("."));
      res.setHeader("content-type", TYPES[ext] ?? "application/octet-stream");
      createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  // rootはcwd基準でなくconfig file基準 — node --testはpackage dirで走る。
  root: fileURLToPath(new URL("./harness", import.meta.url)),
  optimizeDeps: {
    // 毎回re-optimizeして初回loadが数分固まる。依存は全てESMなので
    // prebundle自体を切ってmodule requestのまま配る。
    noDiscovery: true,
    include: [],
  },
  plugins: [serveFixtures(), woff2Only(), solid()],
});
