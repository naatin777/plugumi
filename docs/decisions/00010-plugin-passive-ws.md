---
type: decision
title: "Plugin通信: 共通規格はCore→Plugin REST、Tool実行はWS"
description: PluginはCoreを知らず接続も開始しない。登録・検査系はCore→PluginのREST、Tool呼び出しの流路だけをWS+JSON-RPC 2.0とする決定。
status: draft
relations:
  contract:
    - '00001'
    - '00002'
    - '00003'
---

## コンテキスト

`docs/decisions/00007` で「REST基本 + WS transport」の2層構成を決めたが、Plugin→Core向きだったため `core_url` が要り、受動Pluginの思想と矛盾していた。一度は「Core→Plugin WSに全統一」も検討したが、共通規格（登録・検査系）までWSにすると:

- **OpenAPI codegenの理想が届かない**。共通規格をOpenAPIで記述し、任意言語のPlugin server骨格を生成する目標に対し、WS部分は記述できない
- 「toolsを扱うときだけWS、共通の規格はREST」という当初の切り分けが一番単純だった

## 決定

1. **PluginはCoreのURL・Domainを知らない**。`core_url` は廃止。PluginからCoreへの新規接続は一切存在しない
2. **共通規格はCore→PluginのREST**。PluginはHTTP serverとして以下を受け付ける:
   - `POST /v1/link/hello`（linkId払い出し）
   - `POST /v1/link/ping`（生存確認。方向はCore→Pluginに反転）
   - `GET /v1/tools`（PluginのTool宣言のpull）
   - `POST /v1/tools/catalog`（全Tool一覧のpush）
   - `GET /v1/transport?linkId=`（WS upgrade受付）
3. **WSはTool呼び出しの流路だけ**。`tools.call` と `tools.call.output`/`result`/`close` のみが流れる
4. **REST + OpenAPIはPlugin側・Core管理面の両方の正本**（Plugin側はcodegen目標、Core側はUI Host・人間用）
5. **リモート接続を正式な前提にする**。CoreとPluginは別マシンにあり得、Core→Pluginの到達性を確保すればよい。TLS・認証・権限管理は別設計事項（未解決）

## 代替案

- **全operationをWSに統一（一度採用しかけた案）**: 概念は単純だが、共通規格までOpenAPIの外に出る。`tools.catalog`のようなpushも、Core→Plugin RESTなら `POST` で表せる
- **Plugin→Core REST（従前）**: `core_url` が必須になり、Pluginにclient実装を要求する。本決定の否定対象
- **Plugin→Core接続**: `docs/decisions/00004` で既に却下（接続先Coreの把握・再接続責務の分散）

## トレードオフと帰結

- **Pluginの実装面**: HTTP server（REST受付＋WS upgrade）だけでよい。client・再接続・Core URL設定は不要
- **OpenAPIがPlugin側にも効く**。共通規格はRESTなので、Rust/TypeScript等のserver stub生成・閲覧UIがそのまま使える
- **Linkの寿命はtransportの寿命と一致する**。WS切断 = Link失効、再接続は新 `linkId`。`link.ping` は半開き接続の検出に残るが、向きはCore→Plugin
- **呼び出し元へのTool一覧はCoreが `POST /v1/tools/catalog` でpushする**。一覧を取りに行く必要はない
- **Plugin→CoreのrequestはWS上に存在する**（`tools.call`のcaller側がそれ）。登録系でPlugin→Coreが要る設計は入れない
- **Plugin Endpointは `http(s)://`**。WS upgradeもHTTP上のhandshakeなので、endpointはHTTP URLで表す
