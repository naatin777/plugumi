import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanUI, serveAsset, validatePanels } from "../dist/assets.js";

test("scanUI computes sha256-addressed manifest and serves assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "plugumi-ui-"));
  try {
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(join(root, "index.html"), "<html></html>");
    await writeFile(join(root, "nested", "app.js"), "console.log(1)");
    const { manifest, files } = await scanUI({
      root,
      panels: [{ panelId: "main", title: "Main", entry: "index.html" }],
    });
    assert.equal(manifest.files.length, 2);
    assert.equal(validatePanels(manifest), undefined);
    const paths = manifest.files.map((file) => file.path).sort();
    assert.deepEqual(paths, ["index.html", "nested/app.js"]);

    const served = await serveAsset(files, "nested/app.js");
    assert.equal(Buffer.from(served.content, "base64").toString(), "console.log(1)");

    // manifestに載っていないpathとroot外への脱出は拒否する。
    assert.ok("error" in (await serveAsset(files, "../escape.txt")));
    assert.ok("error" in (await serveAsset(files, "missing.txt")));

    // entryがfilesにないpanel宣言は検証で潰す。
    const broken = await scanUI({ root, panels: [{ panelId: "bad", title: "Bad", entry: "none.js" }] });
    assert.match(validatePanels(broken.manifest), /not in the UI root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
