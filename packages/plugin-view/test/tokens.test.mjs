// tokenNames が plugin-shell の tokens.css の変数名と一致することを検査する。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tokenNames } from "../dist/index.js";

const css = readFileSync(new URL("../../../shared/plugin-shell/src/styles/tokens.css", import.meta.url), "utf8");
const inCss = new Set(css.match(/--plugumi-[a-z0-9-]+/g));

const flatten = (value) =>
  Object.values(value).flatMap((entry) =>
    typeof entry === "string" ? [entry] : flatten(entry));

test("tokenNames は tokens.css の変数名と一致する", () => {
  const names = flatten(tokenNames);
  assert.equal(new Set(names).size, names.length, "tokenNames に重複がある");
  assert.deepEqual([...new Set(names)].sort(), [...inCss].sort());
});
