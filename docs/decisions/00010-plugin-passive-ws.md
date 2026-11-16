---
type: decision
title: "Plugin通信: Core→PluginのWebSocket + JSON-RPCに統一"
description: Core↔Plugin通信をWS+JSON-RPC 2.0に一本化し、Pluginを完全受動にする決定。REST+OpenAPIはCore管理・UI向けのみに残す。
status: draft
relations:
  contract:
    - '00001'
    - '00002'
    - '00003'
---

## コンテキスト

`docs/decisions/00007` で「REST基本 + WS transport」の2層構成を決めたが、実装を通じて問題が明らかになった:

- **PluginがCoreのURLを知る構造になっていた**。`link.hello` で `core_url` を渡し、Plugin→Core REST（tools.set・ping・tools.list）とPlugin→Core WS接続をさせる設計は、受動Pluginの思想と矛盾する
- **Pluginの実装負荷が大きい**。任意言語でPluginを書けることが目標なのに、HTTP server・WS client・HTTP client・再接続loopを全言語で要求していた。実際のバグ（hello競合・再接続・Link差替え）もこの部分に集中した
- **core.urlは信頼できない値を渡している**。helloを送れた者なら任意のURLへPluginを接続させられる。PluginはそのURLを検証する術を持たない
- REST操作とWS操作の振り分けが「どちらがどちらを知るか」の混乱を生み、設計の意図が読み取りにくかった

## 決定

1. **Core↔Plugin通信は WebSocket + JSON-RPC 2.0 に統一する**。Plugin通信のためにRESTとWebSocketの両方を維持しない
2. **接続はCoreが開始する**。Coreは設定済みのPlugin Endpoint（`ws(s)://<host>:<port>`）へ `GET /v1/transport` でWS接続を開く。PluginからCoreへの新規接続は一切存在しない
3. **PluginはCoreのURL・Domainを知らない**。`core_url` は廃止する。Link確立に必要なのは `linkId` と `core.id`（不透明な識別子。宛先としては使えない）だけ
4. **全operationが同じWS上を流れる**: `link.hello`・`tools.set`・`link.ping`・`tools.catalog`・`tools.call`・`plugins.*`。切断時の再接続はCoreが担当する
5. **REST + OpenAPIはCoreの管理・UI向けAPIとして残る**（UI Host・人間用）。PluginはRESTを使わない
6. **リモート接続を正式な前提にする**。CoreとPluginは別マシンにあり得、`wss://` 経由を想定する。TLS・認証・権限管理は明示的な別設計事項（未解決）とする

## 代替案

- **HTTP hello + Plugin→Core WS（従前）**: `core_url` が必須になり、Pluginにclient実装を要求する。本決定の否定対象
- **REST hello + Core→Plugin WS（RESTを残す案）**: helloだけRESTにするとPluginはHTTP serverを要求されるが、WS upgrade自体がHTTP上の handshake なのでREST分離の意味がない。WSを1本張ればその上でhelloできる
- **Plugin→Core接続**: `docs/decisions/00004` で既に却下（接続先Coreの把握・再接続責務の分散）

## トレードオフと帰結

- **Pluginの実装面が最小になる**。WS serverのupgrade受付と、WS上のJSON-RPC応答だけでよい。client・再接続・設定は不要
- **Linkの寿命はtransportの寿命と一致する**（旧設計の「Linkとtransportは別寿命」は解消）。WS切断 = Link失効、再接続は新 `linkId`。`link.ping` は半開き接続の検出用に残る
- **呼び出し元へのTool一覧はCoreがpushする**。Pluginは `tools.catalog` notificationを受け取るだけで、一覧を取りに行かない
- **Coreが全ての到達性責務を持つ**。Coreから到達できないPluginは利用対象外（00004踏襲）。リモートのTLS・認証は `docs/decisions/00003` に倣い別設計
- OpenAPI資産（生成・閲覧）はCore管理API側で引き続き使えるが、Plugin向け契約の正本は本contractになる。OpenAPI codegenでPlugin実装を生成する理想は、双方向RPCを記述できないため届かない
