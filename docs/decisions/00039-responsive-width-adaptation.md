---
type: decision
title: responsiveの基準はviewportではなくcontainerの幅とし、幅の契約はCSS変数を介さない
description: panelはsplitで幅が変わるためviewport基準のmedia queryは誤りであり、container queryを既定機構とすること、CSS変数がquery条件式で使えない制約により幅の契約をTSの数値としてexportすることを記録する。
status: draft
relations:
  decision:
    - '00038'
---

## コンテキスト

panelはsplitやwindow resizeで幅が変わる。幅に応じた適応（responsive design）が必要になるが、通常のwebの作法であるviewport基準のmedia queryは、plugumiではほぼ誤りになる — splitで狭くなったpanelはviewport幅に現れない。実際、Style Labのsidebar collapseはResizeObserverでpanel実幅を見る実装になっている。

あわせて技術的制約がある: CSS変数はmedia query・container queryの**条件式**では使えない（`var()`はプロパティ値でのみ解決される）。そのためtoken契約と同じ形（`--plugumi-*`のCSS変数）では幅の契約を表現できない。

## 決定

### 基準はcontainerの幅

responsiveの基準はviewportではなくpanel（container）の幅とする。機構の使い分け:

- **container query**: 既定。CSSだけで完結し、部品が置かれた幅に反応する。見た目の適応はまずこれ
- **ResizeObserver**: DOM構造やJS stateが変わる場合（sidebarのhamburger化など）。境界には`widths`契約の値を使う
- **media query**: viewport基準。panelにはほぼ誤り — window全体に関係するshellレベルだけ

### 幅の契約はTSの数値

`widths`（`packages/view-core/src/design/widths.ts`）としてTSの数値をexportする。CSS側（container queryの条件式）はリテラルを書くしかなく、二箇所に値が存在する構造は避けられない — 書くときは契約の値に合わせる。値はusage-drivenに育て、実証された境界だけを置く。最初の実証はStyle Labのsidebar collapse（`compact: 560`）。

## 代替案

- **幅もtoken契約（CSS変数）に載せる**: 条件式で使えないため参照方法がない。却下
- **3階層以上のtier体系を先に定義する**: 実証された境界は1つしかなく、推测の階層はtoken監査で削った先走りと同じ構造になる。実使用から育てる方針を取る
