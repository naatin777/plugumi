// class参照のcheck（decisions/00044 — CSS Modulesを捨てた代わりの保護）。
// moduleのhashがあった頃はJSXのclass名typoがbuild errorになったが、
// plain CSSでは参照ミスがサイレントに「styleが効かない」になる。
//
// Rule — tsxのclass属性に現れるclass名は、どこかのcssで定義されている
//   こと。tree全体を1つの集合として突合する（file単位の対応は見ない
//   — shellがcross-componentにclassを使うのは正しいため）。
//   逆方向（cssにあってどこでも使われないclass = dead code）も検査
//   する。ただしplugumi-*はplugin作者向けの公開APIなので対象外 —
//   repoの外から参照される契約であり、repo内に参照がなくてもdeadではない。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const repoRoot = join(import.meta.dirname, "../../../..");
const scanRoots = ["shared", "packages", "apps", "plugins"];

function collect(dir: string, exts: string[], out: string[] = []): string[] {
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
      collect(full, exts, out);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const cssFiles = scanRoots.flatMap((root) => collect(join(repoRoot, root), [".css"]));
const tsxFiles = scanRoots.flatMap((root) => collect(join(repoRoot, root), [".tsx"]));

// ---- css側: selector中のclass名を集める。comment・string・url()を
// 落としてから `.name` を拾う（decimalの.5などは先頭が数字なので
// 自然に除かれる）。 */
const defined = new Set<string>();
const definedIn = new Map<string, string>();
for (const file of cssFiles) {
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"[^"]*"|'[^']*'/g, " ")
    .replace(/url\([^)]*\)/g, " ");
  for (const match of text.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) {
    defined.add(match[1]);
    if (!definedIn.has(match[1])) definedIn.set(match[1], relative(repoRoot, file));
  }
}

// ---- tsx側: class=属性の中身だけを取り出し、その中の文字列literalを
// 集める。属性値の形式は ".." / {".."} / {`..`} / {{ key: cond }} で、
// どの形式でも属性式の中の文字列literalは全てclass名かその断片。
// 式の残り（変数参照・条件式）は静的には追えないが、このrepoでは
// class名を変数に入れない規約なので文字列だけ見れば足りる。 */
function extractClassAttributeRegions(text: string): string[] {
  const regions: string[] = [];
  const attr = /(?:^|\s)class=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(text))) {
    let i = m.index + m[0].length;
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      if (end !== -1) regions.push(text.slice(i + 1, end));
    } else if (text[i] === "{") {
      // braceをbalanceさせて式全体を取る（文字列・template中のbraceは無視）。
      let depth = 0;
      const start = i;
      while (i < text.length) {
        const ch = text[i];
        if (ch === '"' || ch === "'" || ch === "`") {
          const end = text.indexOf(ch, i + 1);
          if (end === -1) break;
          i = end + 1;
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) { i++; break; }
        }
        if (depth >= 1 && i > start) { /* consume */ }
        i++;
        if (depth === 0) break;
      }
      regions.push(text.slice(start + 1, Math.max(start + 1, i - 1)));
    }
  }
  return regions;
}

const CLASS_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const referenced = new Map<string, { file: string; line: number }>();
for (const file of tsxFiles) {
  const text = readFileSync(file, "utf8");
  for (const region of extractClassAttributeRegions(text)) {
    for (const lit of region.matchAll(/"([^"]+)"/g)) {
      for (const token of lit[1].split(/\s+/)) {
        if (!CLASS_TOKEN.test(token)) continue;
        if (!referenced.has(token)) {
          const upto = text.indexOf(region);
          referenced.set(token, {
            file: relative(repoRoot, file),
            line: text.slice(0, upto).split("\n").length,
          });
        }
      }
    }
  }
}

// ---- 逆方向用: ts/tsxの全本文をcrudeにscanする。class=属性に限らず、
// JS動的生成（drag-ghost等）やpanel shadow DOMのHTML templateなど、
// class名はどこかに文字列として現れるはず。comment中の言及も参照と
// みなす — liveなclassをdeadと誤報して消される方が害なので、
// 検出はconservativeに寄せる。 */
const tsFiles = scanRoots.flatMap((root) => collect(join(repoRoot, root), [".ts", ".tsx"]));
const allSource = tsFiles.map((file) => readFileSync(file, "utf8")).join("\n");

describe("class参照のcheck", () => {
  it("tsxのclass属性のclass名はcssで定義されている", () => {
    const violations: { token: string; file: string; line: number }[] = [];
    for (const [token, at] of referenced) {
      if (!defined.has(token)) violations.push({ token, ...at });
    }
    assert.deepEqual(violations, []);
  });

  it("cssで定義されたclassはどこかのソースで参照されている（dead code無し）", () => {
    const dead: { token: string; file: string }[] = [];
    for (const token of defined) {
      // plugumi-*はplugin作者向けの公開API — repoの外から参照される。
      if (token.startsWith("plugumi-")) continue;
      const pattern = new RegExp(`[^a-zA-Z0-9_-]${token}[^a-zA-Z0-9_-]`);
      if (!pattern.test(allSource) && !allSource.startsWith(token)) {
        dead.push({ token, file: definedIn.get(token) ?? "?" });
      }
    }
    assert.deepEqual(dead, []);
  });
});
