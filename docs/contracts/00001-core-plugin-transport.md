---
type: contract
title: Core↔Plugin 接続契約（MVP・REST）
description: CoreがPluginへ接続し、Sessionを確立してTool宣言を受け取るまでの最小契約。HTTP+JSONのRESTで構成する。
status: draft
relations:
  architecture:
    - '00001'
---

## 当事者と範囲

Core と Plugin の双方が実装する通信境界。

- 基本は **HTTP/1.1 + JSON の REST**。request/responseで足りる処理はすべてここに載せる（OpenAPI化を見据える）
- Tool呼出・途中出力・通知などrequest/responseで表せない部分は **WebSocket + JSON-RPC 2.0**（`docs/contracts/00002`、呼出形態は `docs/contracts/00003`）
- **Panel ↔ Plugin の通信は本契約の対象外**。Pluginのフロントエンド⇄バックエンド間はWS・WebRTC・GraphQL等を自由に選んでよい。Plugumiが規定するのはCore↔Pluginと、UIを提供・配置する枠組みだけ
- Pluginプロセスは外部起動を前提とする（Coreはspawnしない）

## Endpoint

- Pluginは `http://<host>:<port>` で待受し、CoreからのREST呼出を受ける
- Coreは `http://<host>:<port>` で待受し、PluginからのREST呼出を受ける。CoreのURLは handshake でPluginに伝える
- いずれもMVPではloopback・認証トークン無し（安全性の前提は後述）。リモート接続・TLS・認証は `docs/decisions/00003` に従い後付け可能な別設計事項

## Plugin Endpointの解決

Coreは起動設定でPlugin Endpoint一覧を持ち、各Endpointへ接続を試みる。

- 設定形式・場所は実装時に決定（候補: `plugumi.toml` 等の静的リスト）
- 接続不能なPluginは一定間隔で再試行する（MVPの方針。間隔・上限は実装詳細）

## Sessionのライフサイクル

1. CoreがPluginのHTTP Endpointへ `POST /v1/session/hello` を送る
2. Coreが払い出した `registrationId`・`sessionId`・`core_url`・protocolVersionを伝え、Pluginは自身の識別情報を返す
3. Pluginは以後 `core_url` 宛てに `tools.set` 等のPlugin→Core操作を呼ぶ
4. Sessionは `session.ping` の定期送信で維持し、一定期間pingが無い場合Coreが失効させる（詳細は `docs/designs/00002`）
5. Session失効で `registrationId`・Tool宣言はすべて消える（session-scoped）

再接続は新しい `session.hello` からやり直し、新IDが払い出される。

## Operations

### `POST /v1/session/hello`（Core → Plugin）

Sessionを確立する最初の呼出。Coreが払い出したIDと自身のURLを伝える。

```jsonc
// request body
{ "protocolVersion": "0.1.0",
  "sessionId": "s-…",
  "registrationId": "reg-…",
  "core": { "url": "http://127.0.0.1:PORT", "version": "…" } }
// response body
{ "plugin": { "id": "my-plugin", "version": "0.1.0", "name": "My Plugin" } }
```

- `protocolVersion` のメジャー不一致はPluginが4xxで応答し、Sessionは成立しない
- `plugin.id` は実装を識別する文字列。一意性はCoreに要求しない（同一実装の複数登録を許す）

### `POST /v1/tools/set`（Plugin → Core）

このRegistrationが提供するTool一覧を**アトミックに置き換える**。接続時と宣言変更時に送る。

```jsonc
// request body
{ "sessionId": "s-…",
  "tools": [ { "toolPath": "fs/read",
               "description": "…",
               "tags": ["fs", "read"],
               "inputSchema": {…}, "outputSchema": {…} } ] }
// response body
{ "count": 1 }
```

- `sessionId` で呼出元Sessionを識別する（CoreはSessionから呼出元を判断し、自己申告の信頼性はSession確立に依存する）
- `toolPath` は登録内で一意な文字列（構造は open question）。重複は4xx
- `description` `tags` `inputSchema` `outputSchema` は任意フィールド

### `POST /v1/session/ping`（Plugin → Core）

Sessionの維持信号。

```jsonc
// request body
{ "sessionId": "s-…" }
// response body
{ "ok": true }
```

## エラー

- HTTPステータス: 400 invalid params / 401 未hello・未知Session / 404 未知Endpoint / 409 状態衝突（toolPath重複等）/ 426 `protocolVersion` 不一致
- error body は `{ "error": { "code": "…", "message": "…" } }` の形を基本とする

## セキュリティと適合性

- **安全性の前提**: MVPはloopbackのみで、外部ネットワークから到達できないことが前提。Coreと同じユーザー権限のプロセスは本契約上すべて信頼できる呼出元とみなす（`docs/decisions/00001` の信頼モデルと整合）
- loopback外へ公開する場合は、認証・TLSを必須とする別contractが必要になる
- 1 Pluginは複数Coreからの接続を受け付け得る。SessionはCoreごとに独立し、`registrationId` はCore内の名前空間で衝突しない

## 未解決の問い

- `toolPath` の構造（`seg/seg` 階層か、flat文字列か）
- `session.ping` の間隔・失効期限（`docs/designs/00002` で詳細化）
- 明示的な終了操作（`session.bye` 等）を定義するか
