---
type: decision
title: operation / Execution中心のworkbenchの方向と機能分類の検討枠組み
description: plugin-centricではなくoperation中心とする方向、5分類のtaxonomy、provider scope・host sessionの検討要素を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00021'
    - '00022'
    - '00024'
---

## コンテキスト

modstrataの「全部Plugin」では、寿命・trust level・target・AIへ見せるべきかが異なるもの（GitHub連携、filesystem、AI agent、browser automation、host notification、DiffViewerなど）が同じ枠に入り、扱いづらさを生んだ。重要なのは「汎用性を捨てることではなく、汎用機構の使い方を意味づけて絞ること」である。

## 決定

**方向**: Plugumiはplugin-centric platformではなく**operation / Execution中心のworkbench**とする。Pluginはoperationを供給する1つの形態であって、すべてのoperationの正体ではない。仕組み（operation invocation、execution ref、resource reference、error表現、streaming等のplumbing）はuniformにし、概念と寿命とUXはuniformにしない。

**機能の意味上の分類**（旧検討枠組み。capabilityという語は[Decision 00033](00033-retire-capability-terminology.md)で廃止）:

1. **Core built-in機能** — workspace state、execution registry、interaction state、operation routingなど。常に存在するCore機能
2. **UI App operation** — notification、clipboard、file picker、native browser viewportなど。host sessionに属し、hostが閉じたら使えない。durable desired stateにせず、plugin listに出さない
3. **Environment / service operation** — filesystem、shell、terminalなど。hostが閉じても生きている必要がある
4. **Plugin** — GitHub、Slackなど利用者が追加する外部拡張パッケージ
5. **Representation Provider** — DiffViewer、TerminalViewなど「どう見せるか」。operation（何ができるか）とは分ける

**hostの扱い**: Hostをplugin registrationとして見せず、**host session**（host kind、device identity、user presence、利用できるUI App operation、trusted状態）として登場させる。UI App operationはsessionの属性である。

**AIへの見せ方の原則**（検討中）: AIはprovider implementationではなく**operationと実行対象を選ぶ**。providerがbuiltinかhostかserviceかpluginかはrouting / policy / lifecycleの問題であり、AIの第一関心ではない。

**environmentがUIを配信しない理由**: environment（旧standard）はbuilt-in environment operationなので、表現はplatformがbuilt-in viewとして持てる。environmentはheadlessでresource / state / eventだけ返す。Pluginだけが自分で表現（declarative surface / custom component）を供給する必要がある。

## 代替案

modstrataから引き継ぐべきもの（UI App operationをremote operationとして呼べる実証、reconciliation、persistent execution、terminalのUI-independent sessionなど）は引き継ぐが、「全部Plugin」という世界観は引き継がない、という判断。すべてをplugin registrationとして見せる案は却下。

## トレードオフと帰結

未解決の帰結:

- provider sessionやoperation metadataのうち、scopeと利用可能期間は[Decision 00024](00024-operation-invocation-context-and-execution.md)に従いprovider sessionからCoreが導出する。user presence・risk・表示用metadataは未設計
- **operation indirection**は[Decision 00024](00024-operation-invocation-context-and-execution.md)で、operation pathへの一本化・context自動解決・Execution統一として決めた。Contract 00004の改訂と実装検証を行ってから[Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md)等の復元draftをacceptedにする
- operationの意味が標準化できるかどうかが、built-inとpluginの実際の境界線になる（[Decision 00022](00022-built-in-plugin-boundary.md)参照）
