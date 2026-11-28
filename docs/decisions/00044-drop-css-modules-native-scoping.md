---
type: decision
title: CSS Modulesを捨て、native CSS（@layer + data-part + @scope）にscopingを統一する
description: appのCSSがCSS Modules・global plugumi-*・data-part・cascade layerの4仕組み混在で混乱している問題に対し、ビルド時hash化を捨ててnative CSSの仕組みだけに統一する方針を記録する。shadow DOMはplugin panelの境界に限定して継続する。
status: draft
relations:
  decision:
    - '00040'
    - '00043'
---

## コンテキスト

appのCSSに仕組みが4つ混在し、どれで書くかの判断が都度必要になっていた:

1. CSS Modules（hash化される`.module.css`） — appのlayout用
2. global `plugumi-*` class — component primitive用
3. `data-part`属性セレクタ — moduleと相性が悪い部分の逃げ場
4. cascade layer — 優先順位の制御

しかも仕組み間に相性の悪さがある。公開classの`plugumi-*`をmodule CSS内でセレクトするとhash化されて壊れる（実際にtabのactivity stylingが効いていなかった）。Style Labが`tab-strip.module.css`をraw importしているのもmodule化の境界が機能していない証拠。

調査の結果、以下が分かった:

- **@layer・CSS Modules・shadow DOM・@scopeは競合ではなく別物** — それぞれ優先順位・名前・DOM・セレクタ到達範囲をscopeする。混乱の原因は目的が重複したまま併用していること
- shadow DOMはisolationでありscopingではない。theming・token共有・form・focusが全てboundaryでnegotiationが要る。正しい使い道は第三者コンテンツの隔離 — plugumiのplugin panelはまさにこれで現状維持が正しいが、first-partyの一枚岩であるapp自身をisolateする理由はない
- appのlayoutは`main.app[data-size=medium] .sub-pane`などcomponentを跨ぐ構造セレクタに強く依存しており、shadow DOM化するとこれらが全て使えなくなる
- **`@scope`が全browserに揃った**（Chrome 118+、Safari 17.4+〔実質17.5+〕、Firefox 146+）。donut scopeでBEMやhash化なしにcomponent境界を書ける
- ライブラリ側に答えは無い。Vue/Svelteのscoped stylesはframework依存でSolidには無く、vanilla-extractはhash方式をAPI違いで提供するだけで仕組みの数は減らない。utility系・compile-time系は00040の理由（runtime token契約との衝突）で引き続き不適

## 決定

**CSS Modulesを捨て、native CSSだけに統一する。** browser supportは「最新browserが対応していれば良い」とする。

- appのCSSはplain CSSファイルとしてcolocateし、内容は`@layer`に入れる
- componentを跨ぐlayout ruleは`data-part`セレクタで正直にglobalに書く（appの本質）
- component内部の細部でreachを制限したいものは`@scope`（donut scope）を使う
- `plugumi-*`はglobalの公開classのまま。module hashが無くなるのでどこからでも安全にセレクトできる
- plugin panelは引き続きshadow DOM + adopted stylesheets（境界は不変）
- 型安全性（JSXでのclass名typo検出）は失われるが、data-part属性は元々文字列であり実害は限定的と判断

### 移行の進め方

まず1コンポーネント（sidebar）で試験移行し、規約の感触を確認してから残りに広げる。

### 補足: lintとcheck体制（2026-02追加）

CSS Modulesを捨てて失われる保護（JSXのclass名typo検出）とCSS自体の品質を以下で補う:

- **Stylelint**（`stylelint.config.mjs`）— `pnpm run lint:css`で実行。error検出系のrecommended config。`no-descending-specificity`は両立しないstateや意図的なbase-after-detailの並びまで警告するため無効化。導入時に`.lab-hole`の重複定義を実際に発見した
- **class参照check**（`shared/app-ui/src/styles/class-usage.test.ts`）— token-usage.test.tsと同じtest-as-checkパターン。tsxのclass属性に現れるclass名がtree内のどこかのcssで定義されていることを突合する。biomeのcross-language rule（noUndeclaredClasses/noUnusedClasses）はshadow DOM adoptionやplugumi-*契約を理解できず158件のfalse positiveを出したため不採用 — アーキテクチャを知っている自作checkが正確
- oxlintはCSSをout of scopeと明示しており対象外（JS/TSのlintとしては別件の候補）
