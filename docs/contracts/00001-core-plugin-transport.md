---
type: contract
title: Core↔Plugin 接続契約（MVP）
description: CoreがPluginへ接続し、sessionを確立してTool宣言を受け取るまでの最小契約。
status: draft
relations:
  related_to:
    - '00001'
---

## Parties and scope

Core と Plugin の双方が実装する通信境界。UI Host ↔ Core の境界は別contractとする。

**MVPの範囲は「接続・session確立・Tool宣言」まで**。Tool呼出・Discovery・Streaming・Node宣言は後続のcontractで定義する。

- 通信は **WebSocket + JSON-RPC 2.0**
- **Core → Plugin 方向に接続する**（PluginがWSサーバーとして待受）。Coreは接続先Pluginのendpoint一覧を設定で持つ
- handshakeでCoreが自身の **core_url** をPluginへ伝える。PluginがWeb UI等からCoreへ到達するための情報
- Pluginプロセスは外部起動を前提とする（Coreはspawnしない）
- 全メッセージは1接続上で順序保証される。切断中の未配送・再接続時のreplayは行わない

## なぜWebSocketか

MVPの目的は「CoreとPluginが接続状態を持つ」ことであり、session=接続の存在そのものである。永続接続が前提なので、接続・切断の検出が自然な双方向channel（WebSocket）を採る。JSON-RPC 2.0 は request/response/notification のフレーミング・id相関・error形状を自前で発明せず済むため。

宣言・検索・呼出などrequest/responseで足りる機能は、後続設計で別transport（HTTP等）に載せる可能性を排除しない — 本contractは接続路だけを定める。

## Endpoint

- Pluginは `ws://<host>:<port>/ws` で待受（各Pluginが自分のportを持つ）
- Coreは `ws://<host>:<port>/ws` でも待受し、`core_url` としてPluginに提示する（Plugin側UIや将来のPlugin→Core経路のため）
- いずれもMVPではloopback・認証トークン無し。リモート接続・TLS・認証は `docs/decisions/00003` に従い後付け可能な別設計事項

## Plugin endpoint の解決

Coreは起動設定でPlugin endpoint一覧を持ち、各endpointへ接続を試みる。

- 設定形式・場所は実装時に決定（候補: `plugumi.toml` 等の静的リスト）
- 接続不能なPluginは一定間隔で再試行する（MVPの方針。間隔・上限は実装詳細）

## Session lifecycle

1. CoreがPluginのWS endpointへ接続する
2. Coreが `session.hello` を送信し、`registrationId`・`core_url`・protocolVersionを伝える
3. Pluginは自身の識別情報（plugin.id等）を返す
4. Pluginが `tools.set` で提供Tool一覧を宣言する
5. WS切断でsession終了。`registrationId`・Tool宣言はすべて失効する（session-scoped）

再接続は新しい `session.hello` からやり直し、新IDが払い出される。

## Methods

### `session.hello`（Core → Plugin、request）

接続直後の最初のrequest。Coreがsessionを確立し、自分のURLと払い出したIDを伝える。

```jsonc
// params
{ "protocolVersion": "0.1.0",
  "registrationId": "reg-…",
  "core": { "url": "ws://127.0.0.1:PORT/ws", "version": "…" } }
// result
{ "plugin": { "id": "my-plugin", "version": "0.1.0", "name": "My Plugin" } }
```

- `protocolVersion` のメジャー不一致はPlugin側がerrorで応答し、Coreは接続を閉じる
- `plugin.id` は実装を識別する文字列。一意性はCoreに要求しない（同一実装の複数登録を許す）

### `tools.set`（Plugin → Core、request）

このregistrationが提供するTool一覧を**アトミックに置き換える**。接続時と宣言変更時に送る。

```jsonc
// params
{ "tools": [ { "toolPath": "fs/read",
               "description": "…",
               "tags": ["fs", "read"],
               "inputSchema": {…}, "outputSchema": {…} } ] }
// result
{ "count": 1 }
```

- `toolPath` は登録内で一意な文字列（構造は open question）。重複はerror
- `description` `tags` `inputSchema` `outputSchema` は任意フィールド
- `session.hello` 完了前の `tools.set` はerror

## Error codes

JSON-RPC 2.0 標準（-32700 parse / -32600 invalid request / -32601 method not found / -32602 invalid params / -32603 internal）に加え:

| code | 意味 |
|---|---|
| -32004 | 許可されない呼出（`session.hello` 前の `tools.set` 等） |
| -32005 | `protocolVersion` 不一致 |

## Security and conformance

- 接続はloopback前提・認証なし。呼出元identityはsessionからCoreが判断する
- MVPの権限モデルは「hello済みsessionからの要求のみ受理」の最小限

## Open questions

- `toolPath` の構造（`seg/seg` 階層か、flat文字列か）
- Tool呼出・Discovery・Streaming・Node宣言のmethod形（後続contract）
- 上記機能のtransport（このWSに載せ続けるか、request/response系はHTTPに分けるか）
- 明示的な切断挨拶（`session.bye` 等）を定義するか
