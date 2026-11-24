// レイアウト基準テスト。主要要素（data-part）のrectと少数のcomputed
// styleを全状態で記録し、コミット済みのbaselineと比較する。
// UPDATE_BASELINE=1 で test/e2e/baseline/layout.json を書き直す。
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import { ab, abEval, acquireBrowser, openPage, releaseBrowser, startServer, PREPARE, COLLECT } from "./browser.ts";

const UPDATE = process.env.UPDATE_BASELINE === "1";
const BASELINE = new URL("./baseline/layout.json", import.meta.url);
const OUT = new URL("./out/", import.meta.url).pathname;

interface Entry {
  key: string;
  rect: number[];
  styles: Record<string, string>;
}

const VIEWPORTS: [number, number][] = [[1440, 900], [1000, 700], [400, 800]];
const drawersFor = (width: number): string[] =>
  width >= 1100 ? ["none"]
    : width >= 800 ? ["none", "sub"]
    : ["none", "sub", "side"];

interface State { name: string; w: number; h: number; theme: string; sub: boolean; drawer: string }

const states: State[] = [];
for (const [w, h] of VIEWPORTS) {
  for (const theme of ["light", "dark"]) {
    if (w >= 1100) {
      for (const sub of [false, true]) {
        states.push({ name: `${w}x${h}-${theme}-sub${sub ? "on" : "off"}-none`, w, h, theme, sub, drawer: "none" });
      }
    } else {
      for (const drawer of drawersFor(w)) {
        states.push({ name: `${w}x${h}-${theme}-${drawer}`, w, h, theme, sub: drawer === "sub", drawer });
      }
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const diff = (state: string, actual: Entry[], expected: Entry[]): string[] => {
  const problems: string[] = [];
  const byKey = new Map(expected.map((entry) => [entry.key, entry]));
  const actualKeys = new Set(actual.map((entry) => entry.key));
  const expectedKeys = new Set(byKey.keys());
  if (actualKeys.size !== expectedKeys.size ||
      [...actualKeys].some((key) => !expectedKeys.has(key))) {
    problems.push(`要素集合が違う: only-actual=${[...actualKeys].filter((k) => !expectedKeys.has(k))} only-expected=${[...expectedKeys].filter((k) => !actualKeys.has(k))}`);
  }
  for (const entry of actual) {
    const want = byKey.get(entry.key);
    if (!want) continue;
    entry.rect.forEach((value, index) => {
      if (Math.abs(value - want.rect[index]) > 1) {
        problems.push(`${entry.key} rect[${index}]: ${want.rect[index]} → ${value}`);
      }
    });
    for (const [prop, value] of Object.entries(entry.styles)) {
      if (value !== want.styles[prop]) {
        problems.push(`${entry.key} ${prop}: "${want.styles[prop]}" → "${value}"`);
      }
    }
  }
  return problems;
};

test("layout baseline", { timeout: 900000 }, async () => {
  await acquireBrowser();
  const { url, close } = await startServer();
  try {
    mkdirSync(OUT, { recursive: true });
    const actual: Record<string, Entry[]> = {};
    let lastKey = "";
    for (const state of states) {
      if (`${state.w}x${state.h}` !== lastKey.split("-")[0]) {
        await ab(["set", "viewport", String(state.w), String(state.h)]);
        lastKey = `${state.w}x${state.h}`;
        // viewport変更後は新規openでレイアウトを作り直す。
        await openPage(`${url}test/demo/a1/?seed=basic`);
        await sleep(1200);
      }
      await abEval(PREPARE({ theme: state.theme, sub: state.sub, drawer: state.drawer }));
      await sleep(400);
      actual[state.name] = await abEval<Entry[]>(COLLECT);
      await ab(["screenshot", `${OUT}${state.name}.png`]);
    }
    if (UPDATE) {
      writeFileSync(BASELINE, JSON.stringify(actual, null, 2) + "\n");
      console.log(`baseline written: ${states.length} states`);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, Entry[]>;
    const problems: string[] = [];
    for (const state of states) {
      if (!baseline[state.name]) { problems.push(`${state.name}: baselineなし`); continue; }
      for (const line of diff(state.name, actual[state.name], baseline[state.name])) {
        problems.push(`${state.name}: ${line}`);
      }
    }
    assert.equal(problems.length, 0, `\n${problems.slice(0, 40).join("\n")}`);
  } finally {
    // browser sessionは使い回す（launch直後のdaemon初期化は重く、
    // 閉じて開き直すほどflakeが増える）。
    await close();
    releaseBrowser();
  }
});
