// panels/instance.ts のうち、Panel Instanceの寿命に関わる純粋な部分
// （resolvePanelの選択規則）を検証する。
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolvePanel } from "./instance.ts";
import type { PanelEntry, PluginPanelEntry, BuiltinPanelEntry } from "../host.tsx";

const plugin = (registrationId: string, panelId = "p", rpcAvailable = true): PluginPanelEntry => ({
  kind: "plugin", registrationId, providerId: "plugin-a", panelId,
  title: `panel ${panelId}`, entry: "ui.js", styles: [], uiSha256: "sha", rpcAvailable,
});

const builtin = (panelId: string): BuiltinPanelEntry => ({
  kind: "builtin", providerId: "app", panelId,
  title: panelId, mount: () => ({ destroy() {} }),
});

describe("resolvePanel", () => {
  it("providerId+panelIdが一致する宣言を選ぶ", () => {
    const panels: PanelEntry[] = [plugin("r2"), plugin("r1"), builtin("theme")];
    assert.equal(resolvePanel({ providerId: "plugin-a", panelId: "p" }, panels)?.registrationId, "r1");
  });

  it("組み込みPanelを解決できる", () => {
    const panels: PanelEntry[] = [plugin("r1"), builtin("theme")];
    const found = resolvePanel({ providerId: "app", panelId: "theme" }, panels);
    assert.equal(found?.kind, "builtin");
    assert.equal(found?.panelId, "theme");
  });

  it("組み込みとpluginが混在してもpluginの選択は従来どおり", () => {
    const panels: PanelEntry[] = [
      builtin("theme"), plugin("r2"), plugin("r1"),
      { ...plugin("r3"), panelId: "other" },
    ];
    assert.equal(resolvePanel({ providerId: "plugin-a", panelId: "p" }, panels)?.registrationId, "r1");
    assert.equal(resolvePanel({ providerId: "plugin-a", panelId: "other" }, panels)?.registrationId, "r3");
  });

  it("rpcAvailableな宣言を優先する（dead登録が残っていてもliveへ移れる）", () => {
    const panels: PanelEntry[] = [plugin("r9", "p", false), plugin("r1", "p", true)];
    assert.equal(resolvePanel({ providerId: "plugin-a", panelId: "p" }, panels)?.registrationId, "r1");
  });

  it("一致が無ければundefined（missing扱い）", () => {
    assert.equal(resolvePanel({ providerId: "x", panelId: "y" }, [builtin("theme")]), undefined);
  });
});
