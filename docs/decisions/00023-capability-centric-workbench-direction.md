---
type: decision
title: capability-centric workbenchの方向とcapability分類の検討枠組み
description: plugin-centricではなくcapability-centricとする方向、5分類のtaxonomy、capability descriptor・host sessionの検討要素を記録する。
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

**方向**: Plugumiはplugin-centric platformではなく**capability-centric workbench**とする。Pluginはcapabilityを供給する1つの形態であって、すべてのcapabilityの正体ではない。仕組み（operation invocation、execution ref、resource reference、error表現、streaming等のplumbing）はuniformにし、概念と寿命とUXはuniformにしない。

**capabilityの意味上の分類**（検討枠組み）:

1. **Core Builtin Capability** — workspace state、execution registry、interaction state、operation routingなど。常に存在するCore機能
2. **Host Capability** — notification、clipboard、file picker、native browser viewportなど。host sessionに属し、hostが閉じたら使えない。durable desired stateにせず、plugin listに出さない
3. **Environment / Service Capability** — filesystem、shell、terminalなど。hostが閉じても生きている必要がある
4. **Extension Plugin** — GitHub、Slackなど利用者が追加する外部拡張パッケージ。本来のPlugin
5. **Representation Provider** — DiffViewer、TerminalViewなど「どう見せるか」。capability（何ができるか）とは分ける

**hostの扱い**: Hostをplugin registrationとして見せず、**host session**（host kind、device identity、user presence、available host capabilities、trusted状態）として登場させる。host capabilityはsessionの属性である。

**AIへの見せ方の原則**（検討中）: AIはprovider implementationではなく**capabilityとtargetを選ぶ**。providerがbuiltinかhostかserviceかpluginかはrouting / policy / lifecycleの問題であり、AIの第一関心ではない。

**environmentがUIを配信しない理由**: environment（旧standard）は標準capabilityなので、表現はplatformがbuilt-in viewとして持てる。environmentはheadlessでresource / state / eventだけ返す。extension pluginだけが自分で表現（declarative surface / custom component）を供給する必要がある。

## 代替案

modstrataから引き継ぐべきもの（host capabilityをremote operationとして呼べる実証、reconciliation、persistent execution、terminalのUI-independent sessionなど）は引き継ぐが、「全部Plugin」という世界観は引き継がない、という判断。すべてをplugin registrationとして見せる案は却下。

## トレードオフと帰結

未解決の帰結:

- **capability descriptor**のうち、scopeとlifetimeは[Decision 00024](00024-operation-invocation-context-and-execution.md)に従いprovider sessionからCoreが導出する。user presence・risk・表示用metadataは未設計
- **capability indirection**は[Decision 00024](00024-operation-invocation-context-and-execution.md)で、operation pathへの一本化・context自動解決・Execution統一として決めた。Contract 00004の改訂と実装検証を行ってから[Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md)等の復元draftをacceptedにする
- capabilityの意味が標準化できるかどうかが、標準搭載とpluginの実際の境界線になる（[Decision 00022](00022-standard-inclusion-boundary.md)参照）
