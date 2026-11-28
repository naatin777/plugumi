---
type: decision
title: 公式UI実装をSolidへ統一し、View protocolはframework非依存に保つ
description: 公式shell・公式panelはSolidで実装し、第三者pluginのView実装は任意frameworkに残す方針を記録する。
status: draft
relations:
  decision:
    - '00008'
    - '00013'
---

## コンテキスト

Web Workbench、共有Panel、公式shellはSolidで実装している。一方、ElectronのSite PanelだけはSvelteで実装されていた。Panel / Viewのmount境界はframework非依存なので混在は動作するが、公式実装の依存・build tool・記法が揃わず、Electron固有panelを特別扱いする理由も文書化されていなかった。

## 決定

- 公式UI実装はSolidへ統一する。対象は公式Workbench shell、公式host frontend、標準panel、およびこのリポジトリで保守するfirst-party plugin Viewとする
- Panel / View protocolはframework非依存のままにする。第三者pluginはSvelte、React、Vueなど任意のframeworkでViewを実装してよい
- ElectronのSite PanelはSolidへ移植し、Svelte依存を取り除く

## 代替案

**Electron Site PanelをSvelteのまま残す。** Panel境界のframework非依存性をdogfoodingできる利点がある。しかし、公式panelが1つだけ別frameworkになる意図がなく、SolidとSvelteの両方の依存と記法を保守する費用に見合わないため採用しない。

**Panel / View protocolでもSolidを必須にする。** 公式実装の統一は簡単になるが、plugin作者のframework選択を狭め、Panelを任意frameworkで実装できる価値を失うため採用しない。

## トレードオフと帰結

得るもの: 公式UIの依存と記法が揃い、build設定、diagnostics、実装例をSolidへ集中できる。

失うもの: 公式panelだけではframework非依存性を常時dogfoodingできない。Panel境界のframework非依存性は、fixtureや第三者plugin向けのcontract testで確認する必要がある。

この方針はplugin作者への制約ではない。Core、Workbench shell、Panel mount APIは、View内部がどのframeworkで書かれているかを前提にしない。
