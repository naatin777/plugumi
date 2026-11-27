---
type: decision
title: design systemはview-coreが契約とコンポーネントを持ちUI Appsが値を定義する
description: platformの視覚言語をtoken契約・コンポーネント・値の3層に分解し、契約とコンポーネントをview-coreへ、値の定義をUI Appsへ配置する方針と、コンポーネントをCSS-onlyで始める決定を記録する。
status: draft
relations:
  decision:
    - '00026'
    - '00037'
  contract:
    - '00005'
---

## コンテキスト

pluginのviewがhostの見た目に追従できる仕組みが欲しい。CSSカスタムプロパティはshadow DOM境界を越えて継承されるため、hostが`:root`で定義した値はpanel内へ自然に届く — この機構は既に動いているが、view作者が参照できる型付きの契約や、見た目の部品は存在しない。旧`@plugumi/plugin-view`には`tokenNames`があったが、package削除とともに失われた。

あわせて`shared/app-ui`という名前の問題があった。中身は「公式UI Apps（web/electron）の共有コンポーネント + デザインシステム」であり、architecture文書で製品全体を指す「workbench」とは別物なので、名前が実態を表していない。

## 決定

### 3層の分解と配置

- **token名の契約**（`--plugumi-*`の名前と意味）: view-coreが持つ。型付きでexportし、view作者が参照する。こちらが名前の正本
- **コンポーネント**: view-coreが持つ。値を一切ハードコードせず`var(--plugumi-*)`だけで書く。view-core自身は値を持たず、実行時にhostのテーマへ自動追従する
- **値**: UI Apps（現`shared/app-ui`）が定義する。tokens.cssが値の正本で、dark/lightテーマとカスタマイズ機構はhostの責務。view-coreは受け取るだけ

### 一致の保証

tokens.cssは契約の全変数に値を与える義務を負う。両者の一致はconformance testでCI検証する（契約はSDK側、実装はhost側、一致はテスト — view channelの型共有と同じ哲学）。

### 上書き

CSS変数のcascadeにより、hostはleafやpanel container単位でローカル上書きできる。テーマ全体の切り替えと部分的上書きは同じ機構で、追加の配線は要らない。

### コンポーネントの形

CSS-only（adoptable stylesheet + class名）で始める。Web Components（`<plugumi-button>`等、振る舞い込みの本物の部品）は将来の方向として残すが、plugin作者の裾野が狭い現段階では投資しない。focus ringやスクロールバーのような見た目と振る舞いの境界にあるものは統一ルールとして扱う。

## 代替案

**デザインシステムを独立packageにする。** platform概念として輪郭は立つが、view作者がSDKとは別にもう1つpackageを意識する必要が出る。view-coreに内蔵すれば「view SDKを入れれば見た目の契約も手に入る」形になり、依存方向も`workbench → view-core`の既存の向きと矛盾しないため採用しない。

**token値の正本もview-coreに持たせる。** 値の定義はhostの責務であり、テーマカスタマイズはhostの機能なので、値をSDKが内蔵するのは所有が逆。採用しない。

**最初からWeb Components。** 振る舞い込みの部品は欲しい方向だが、focus/keyboard/a11yの自前実装は投資が重く、まだview作者が少ない段階では対象読者に見合わない。採用しない。

## トレードオフと帰結

得るもの: view作者は`@plugumi/view`だけで型付きtokenと見た目の部品を得られ、hostのテーマへの追従は自動。UI Appsは自分のchromeと同じ変数系でpanelを迎えられる。

失うもの: view-coreの責務が「接続機械」に「視覚言語の契約と部品」を加えて2つになる。CSS-onlyの部品は振る舞いを持たないので、選択状態やインタラクションは現状view作者の責任のまま。

package名の決定（2026-11-27）: `shared/app-ui`。検討の過程で、shellは業界用例（GNOME Shell / Windows shell / PWA app shell）では常に「実行時の全体」を指す語であり、plugumiではそれはUI App自身に相当するため部品の共有物の名前としては不適という指摘が決定的になった。`app-components`は機械部分が漏れ、`app-design`はchromeが漏れ、`ui-shell`はplugin UI bundleの「UI」と二重意味になる。`app-ui`は「appのUI実装」という素材の名前として全内容を漏れなくカバーし、app-の修飾によりplugin UIとの混同も避けられるため採用した。
