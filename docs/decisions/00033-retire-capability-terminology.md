---
type: decision
title: capability / capability-centricを現行用語から外す
description: capabilityを第一級概念にも分類語にもせず、operation / Execution / resource ref / providerを中心語にする方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00023'
    - '00024'
    - '00031'
    - '00032'
---

## コンテキスト

初期検討では、Plugin、Environment、UI App、外部serviceが提供するものをまとめてcapabilityと呼び、Plugumiをcapability-centric workbenchと表現していた。しかし、Capabilityが第一級Objectなのか、operation pathのprefixなのか、providerが持つ機能なのか、UI表示能力なのかが曖昧になりやすいことが分かった。

operation / Execution modelでは、callerが実際に使うのはoperation pathであり、実行の単位はExecution、参照はresource ref、登録・配送の役割はproviderである。Capabilityを追加しなくても中心モデルを説明できる。

## 決定

- `capability` と `capability-centric` を現行の正式用語として使わない
- Capabilityという第一級Object、登録API、registry、descriptorは設けない
- `filesystem` / `terminal` / `browser` などのoperation pathのまとまりを説明したい場合は、正式語を作らず「機能領域」「operation group」などと普通に説明する
- 中心語は operation / Execution / resource ref / provider / View とする
- UI AppがCoreへ登録するapp-localな操作は、いったん `UI App operation` と呼ぶ。wire field / enumの既存表現を改名するかは別途contract revisionで決める
- 過去のcapabilityという語は、歴史記述または廃止語としてだけ読む

## 帰結

- Architecture 00003の第一級概念は Operation / Resource / Execution / View とする
- capability routingではなくoperation routingと呼ぶ
- capability contractではなくoperation contractと呼ぶ
- AIがprovider implementationではなく選ぶ対象はcapabilityではなくoperationと実行対象である
- UI Appが持つ表示能力やbrowser / OS依存の差分は、必要に応じて普通の日本語で「表示機能」「利用できるoperation」と説明する

## 未解決の問い

- `UI App operation` という仮の呼び名をこのまま使うか
- operation groupをcatalogやpermissionでどう表すか。ただし正式なCapability objectは作らない
