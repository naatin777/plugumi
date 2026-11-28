---
type: decision
title: UI Appとbuilt-inの用語を採用し、分類語を増やさない
description: Workbench HostをUI Appへ、標準装備をbuilt-inへ改め、first-class / baseline / bundledなどの分類語を現段階で正式化しない方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00017'
    - '00022'
    - '00028'
---

## コンテキスト

Web / Electronの公式UIを指す語として `Workbench Host` を使っていたが、長く、`Host` がmachineやremote hostとも混ざりやすかった。一方で、単に `App` と呼ぶと、外部アプリ、Electronアプリ一般、pluginが操作するアプリなどと区別しにくい。

また、製品に最初から入るものを `標準装備` と呼んでいたが、語が分かりにくかった。これを説明するために `first-class` / `baseline` / `bundled` などの分類語を増やす案もあったが、配布や公開plugin運用はまだ先であり、現段階で正式用語を増やすと複雑になる。

## 決定

- Web / Electronの公式UIの概念名は **UI App** とする
- 具体的な実装は **Web app** / **Electron app** と呼ぶ
- `App` 単独は正式な概念名にしない。外部アプリや一般のアプリと混ざるためである
- `標準装備` / `標準搭載` という語は使わず、**built-in** を使う
- `built-in` は実装場所ではなく、利用者が追加installせずに使える製品の基本体験を指す
- 現段階では `first-class`、`baseline`、`bundled`、`official plugin`、`bundled plugin`、`built-in plugin` を正式な分類語として使わない。必要なときは普通の文章で説明する
- `Host Provider` は独立した第一級概念として扱わない。UI Appはapp-local operationをCoreへ登録してよいが、この操作群に専用の概念名はつけず「UI Appが登録するoperation」と普通に説明する。内部実装ではprovider protocolを使ってよい
- wire field / enumの `providerKind: "host"`、`hostSession`、`host-session` は現行contract revisionでは改名しない。改名する場合はcontract revisionの変更として扱う

## トレードオフと帰結

得るもの: Core Daemon、UI App、Environment Provider、Pluginという主要概念を短く説明できる。配布前の段階で分類語を増やさずに済む。

失うもの: `official` と `bundled` の違いのような細かい分類は、必要になった時点で再度決める必要がある。external distributionやplugin配布を設計するときに再検討する。
