---
type: decision
title: CSSライブラリは導入せず、CSS-only + runtime token契約の路線を継続する
description: StyleX・Tailwind・Panda・vanilla-extractの導入検討に対し、compile-time志向のこれらがruntime token注入を中核とするplugumiのアーキテクチャと根本的に衝突するため導入しない決定を記録する。実際の痛み（ad-hoc値の散在・spec drift）はライブラリでは解けず、token化の継続とcheck機構で対処する。
status: draft
relations:
  decision:
    - '00038'
    - '00039'
---

## コンテキスト

design systemが育ってきた段階で、CSSライブラリ（StyleX・Tailwind・Panda・vanilla-extract）を導入すべきかという検討が出た。

## 決定

**導入しない。** CSS-only + runtime token契約の現行路線を継続する。

### 理由: compile-time志向とruntime token注入の衝突

plugumiのdesign systemの中核メカニズムは「値はruntimeにhostが注入し、shadow DOM境界を継承で越える」ことにある。host（UI Apps）がtokens.cssで値を定義し、テーマ切替やユーザーのcustomizeはすべてruntimeに起きる。panelは`var(--plugumi-*)`を参照するだけで、build時に値を知らない。

4つのライブラリはすべてcompile-time志向であり、ここに根本的に衝突する:

- **Tailwind**: utility classに値が焼かれる（`w-4`=1rem）。design決定がmarkupに散らばりruntime themingと戦う。plugin作者全員にbuild pipelineを強制する
- **vanilla-extract**: 思想的には最も近い（型安全・静的抽出・zero runtime）が、createThemeは値をcompile時に焼く。var()参照だけを書くなら「型つきcss執筆tool」として使うことになり本領ではない
- **StyleX / Panda**: 同様にcompile-time theming。babel/vite plugin必須で裾野が狭い

### plugumiが既に持っているもの

これらのライブラリが約束する価値の多くは既に実現されている:

- 型安全性: tokens.ts + cssVar()
- scoping: shadow DOM — class-manglingより強い
- theming: runtime動的 — compile-timeより強い（buildなしに変わる）
- dead code除去: 現規模では問題になっていない

### 実際の痛みはライブラリでは解けない

Style Labの構築を通じて見つかった痛みは以下であり、どれもライブラリ導入では解決しない:

1. ad-hoc値の散在（混色%、半径の不統一）
2. spec表のdrift（手書き注釈）
3. tokenを使わないcssを防ぐ仕組みがない

これらには実績ある値のtoken化の継続（motion-duration-mdの昇格方式）と、module.cssがtokenを使っているかのcheck機構で対処する。

### 例外の可能性

shell内部のcss執筆が大規模化して苦痛になった場合、**shell内部だけ**vanilla-extractを再検討する価値はある（型つきでvar()参照を書く用途）。ただしplugin作者には強制しない — 彼らのtoolchainにbuild pluginを要求すると裾野が死ぬ。現時点ではその苦痛がないため導入しない。
