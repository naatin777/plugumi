// CSS分離テスト。hostile/victim fixture Panelを使い、Plugin CSSが
// Shell・他Panelへ漏れないことを確認する。PanelはShadow DOMへ描かれ、
// 宣言のstylesはそのshadowにだけ入る（@font-faceだけdocumentへ出る）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { ab, abEval, acquireBrowser, openPage, releaseBrowser, reloadPage, startServer } from "./browser.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 検査対象のShell要素と見るstyle。
const SHELL_PROPS = `
(() => {
  const props = ["color", "background-color", "outline-width", "border-top-width",
    "border-left-width", "font-family", "box-shadow"];
  const pick = (el) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p);
    return out;
  };
  return {
    tab: pick(document.querySelector('[data-part="tab"]')),
    dock: pick(document.querySelector('[data-part="dock"]')),
    areaView: pick(document.querySelector('[data-part="area-view"]')),
    titlebar: pick(document.querySelector('[data-part="titlebar"]')),
    areaRow: pick(document.querySelector('[data-part="area-list-row"]')),
    body: pick(document.body),
  };
})()`;

const VICTIM = `
(() => {
  const host = [...document.querySelectorAll('[data-part="panel-host"]')]
    .find((el) => el.dataset.plugumiPlugin === 'victim');
  const cs = (sel) => getComputedStyle(host.shadowRoot.querySelector(sel));
  return {
    text: { color: cs('.victim-text').color, fontFamily: cs('.victim-text').fontFamily },
    button: { borderTopWidth: cs('.victim-button').borderTopWidth,
      color: cs('.victim-button').color, fontFamily: cs('.victim-button').fontFamily },
    input: { color: cs('.victim-input').color, fontFamily: cs('.victim-input').fontFamily },
    bodyFont: getComputedStyle(document.body).fontFamily,
  };
})()`;

// seedにhostileを足してreloadさせる。
const ADD_HOSTILE = `
(() => {
  const s = JSON.parse(sessionStorage.getItem('plugumi:e2e-host'));
  const root = s.workspaces['demo/a1'].center.root;
  root.second.panels.push({ instanceId: 'ph', pluginId: 'hostile', panelId: 'panel' });
  root.second.selected = 'ph';
  sessionStorage.setItem('plugumi:e2e-host', JSON.stringify(s));
  return true;
})()`;

interface Snap { [k: string]: Record<string, string> }

const snapDiff = (before: Snap, after: Snap): string[] => {
  const problems: string[] = [];
  for (const key of Object.keys(before)) {
    for (const prop of Object.keys(before[key])) {
      if (before[key][prop] !== after[key][prop]) {
        problems.push(`${key}.${prop}: "${before[key][prop]}" → "${after[key][prop]}"`);
      }
    }
  }
  return problems;
};

test("css isolation", { timeout: 600000 }, async (t) => {
  await acquireBrowser();
  const { url, close } = await startServer();
  let before: Snap = {};
  let opened = false;
  try {
    await ab(["set", "viewport", "1440", "900"]);
    await openPage(`${url}test/demo/a1/?seed=basic`);
    before = await abEval<Snap>(SHELL_PROPS);

    // hostileをworkspaceへ足してreload（mountはload時に走る）。
    await abEval(ADD_HOSTILE);
    await reloadPage();
    opened = true;

    await t.test("1: Shell要素のcomputed styleはhostileを開く前と一致",
      async () => {
        const after = await abEval<Snap>(SHELL_PROPS);
        const problems = snapDiff(before, after);
        assert.equal(problems.length, 0, problems.join("\n"));
      });

    await t.test("2: victim内の要素はShell・hostileの規則を受けない", async () => {
      const v = await abEval<{ text: { color: string; fontFamily: string };
        button: { borderTopWidth: string; color: string; fontFamily: string };
        input: { color: string; fontFamily: string }; bodyFont: string }>(VICTIM);
      assert.notEqual(v.text.color, "rgb(255, 0, 0)", "text color");
      assert.notEqual(v.button.color, "rgb(255, 0, 0)", "button color");
      assert.notEqual(v.button.borderTopWidth, "3px", "button border");
      // pは継承のfont（bodyと同じ）。button/inputはUA stylesheetがfontを
      // 持つので、victim自身の規則（monospace）が上書きされず効くことを見る。
      assert.equal(v.text.fontFamily, v.bodyFont, "text font-familyは継承");
      assert.match(v.button.fontFamily, /monospace/, "buttonはvictim自身のfont");
      assert.match(v.input.fontFamily, /monospace/, "inputはvictim自身のfont");
    });

    await t.test("3: hostileのpopoverにはhostile自身のCSSが当たる",
      async () => {
        // popoverはcontext.root（hostile自身のShadowRoot）へ出すので、
        // shadow内のstylesが届く。
        const pos = await abEval<string>(`
          (() => {
            const host = [...document.querySelectorAll('[data-part="panel-host"]')]
              .find((el) => el.dataset.plugumiPlugin === 'hostile');
            const pop = host.shadowRoot.querySelector('[data-part="hostile-pop"]');
            return getComputedStyle(pop).position;
          })()`);
        assert.equal(pos, "fixed");
      });

    await t.test("4: Shellのkeyframesはhostileの同名keyframesに置き換わらない",
      async () => {
        // document側のstylesheetを再帰的に数える。同名のkeyframesが
        // Shellの定義1つだけなら、hostileのものはshadow内に閉じている。
        const counts = await abEval<Record<string, number>>(`
          (() => {
            const names = ['shell-aurora', 'plugumi-activity-spin'];
            const counts = {};
            const walk = (rules) => {
              for (const rule of rules) {
                if (rule.constructor.name === 'CSSKeyframesRule' &&
                    names.includes(rule.name)) {
                  counts[rule.name] = (counts[rule.name] ?? 0) + 1;
                }
                if (rule.cssRules) walk(rule.cssRules);
              }
            };
            for (const sheet of document.styleSheets) {
              try { walk(sheet.cssRules); } catch { /* 読めないsheetは飛ばす */ }
            }
            return counts;
          })()`);
        assert.equal(counts["shell-aurora"], 1, "shell-auroraが上書き・複製されている");
        assert.equal(counts["plugumi-activity-spin"], 1, "plugumi-activity-spinが上書き・複製されている");
      });

    await t.test("5: Token値をhostileが画面全体で上書きできない", async () => {
      const token = await abEval<string>(
        `getComputedStyle(document.documentElement).getPropertyValue('--plugumi-colors-text')`);
      assert.notEqual((token ?? "").trim(), "rgb(255, 0, 0)");
    });

    await t.test("6: victimにはTokenと継承が届く", async () => {
      const v = await abEval<{ text: { color: string; fontFamily: string };
        button: { color: string }; input: { color: string }; bodyFont: string }>(VICTIM);
      // textはShell由来の色（muted等）を継承し、fontはbodyのIBM Plex Sans系。
      assert.match(v.text.fontFamily, /Plex Sans|sans-serif/, "font-familyがtoken由来");
      assert.notEqual(v.text.color, "", "colorが継承されている");
    });
  } finally {
    // browser sessionは使い回す（launch直後のdaemon初期化は重く、
    // 閉じて開き直すほどflakeが増える）。
    await close();
    releaseBrowser();
  }
  void opened;
});
