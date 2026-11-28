// token使用のcheck（decisions/00040でライブラリ導入を見送った代わりの
// 方向）。contract外のtoken参照と生の色を機械的に防ぐ。
//
// Rule 1 — 参照解決: var(--plugumi-*)の参照はcontractにあるか、
//   同じtree内で定義（@propertyまたは宣言）されていること。
//   typoや存在しないtokenへの参照はfallbackで見た目が誤魔化されて
//   気付けないため、ここで検出する。
// Rule 2 — 生の色の禁止: tokens.css以外でhex/rgb()/hsl()を書かない。
//   var()のfallbackに埋め込むのも同じ — runtime themingを壊す
//   hidden hardcodeになる。物理的な光の効果など正当な例外は、
//   その行にtoken-check-ignoreと理由を書く。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tokens } from "@plugumi/view";

const repoRoot = join(import.meta.dirname, "../../../..");
const scanRoots = ["shared", "plugins"];
const exts = [".css", ".ts", ".tsx"];

function collect(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "dist-ui" || entry === "test") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full, out);
    } else if (exts.some((ext) => entry.endsWith(ext)) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = scanRoots.flatMap((root) => collect(join(repoRoot, root)));
const contract = new Set(Object.values(tokens));

interface Violation { file: string; line: number; text: string }

// tree内で定義されている変数（@propertyまたは--x:宣言）を先に集める。
// contract外でも内部機構として定義・消費される変数は正当（ただし
// plugumi prefixを付けない方が筋 — decisions/00038のtokens.test参照）。
const defined = new Set<string>();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/@property\s+(--plugumi-[a-z0-9-]+)/g)) defined.add(match[1]);
  for (const match of text.matchAll(/^\s*(--plugumi-[a-z0-9-]+)\s*:/gm)) defined.add(match[1]);
}

const REFERENCE = /var\(\s*(--plugumi-[a-z0-9-]+)/g;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;
const IGNORE = "token-check-ignore";
// tokens.cssは値の正本なので生の色を書いてよい唯一のfile。
const isValueSource = (file: string) => file.endsWith("styles/tokens.css");

describe("token使用のcheck", () => {
  it("var(--plugumi-*)の参照がcontractか内部定義に解決される", () => {
    const violations: Violation[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        for (const match of text.matchAll(REFERENCE)) {
          const name = match[1];
          if (!contract.has(name) && !defined.has(name)) {
            violations.push({ file: relative(repoRoot, file), line: index + 1, text: name });
          }
        }
      });
    }
    assert.deepEqual(violations, []);
  });

  it("tokens.css以外に生の色を書かない", () => {
    const violations: Violation[] = [];
    for (const file of files) {
      if (isValueSource(file)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((text, index) => {
        if (text.includes(IGNORE)) return;
        for (const match of text.matchAll(RAW_COLOR)) {
          violations.push({ file: relative(repoRoot, file), line: index + 1, text: match[0] });
        }
      });
    }
    assert.deepEqual(violations, []);
  });
});
