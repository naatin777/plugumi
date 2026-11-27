// design tokenのconformance test（decisions/00038）。
// 契約（@plugumi/viewのtokens）が名前の正本で、app-uiのtokens.cssは
// その全てに値を与える義務を負う。逆にtokens.cssが契約に無い
// --plugumi-*変数を定義するのも禁止（host専用の変数が必要なら
// plugumi prefixを付けない）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokens } from "@plugumi/view";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");
const defined = new Set(css.match(/--plugumi-[a-z0-9-]+/g) ?? []);
const contract = new Set(Object.values(tokens));

describe("tokens.css の conformance", () => {
  it("契約の全変数に値が定義されている", () => {
    const missing = [...contract].filter((name) => !defined.has(name));
    assert.deepEqual(missing, []);
  });
  it("契約に無いplugumi変数を定義していない", () => {
    const extra = [...defined].filter((name) => !contract.has(name));
    assert.deepEqual(extra, []);
  });
});
