---
type: contract
title: Core↔Plugin 通信トランスポート
description: WebSocket + JSON-RPC 2.0 による双方向通信の基本契約と選択理由。
status: draft
relations:
  related_to:
    - '00001'
---

## Parties and scope

Core と Plugin の双方が実装する通信境界。UI Host ↔ Core の境界は別contractとする。

- 通信は **WebSocket + JSON-RPC 2.0** の双方向
- 1 Pluginは複数Coreへ接続し得る。Coreも複数Pluginと同時sessionを持つ

## なぜWebSocketか

旧実装は plain HTTP/JSON の双方向RESTを採用していた（旧ADR-0079。当時WebSocketを明示的に不採用）。ただしその判断は「Plugin→Core は同期RESTで足りる」という前提 — つまり push が要らなかった時点の決定である。

新しい方向では以下が恒常的な双方向配送を要求するため、永続的な双方向channelが前提になる:

- Streaming Tool が任意タイミングで出力メッセージを返す（`docs/decisions/00002` の `queue.*` / `hook.*` / `result`）
- Push通知（実行状態・Progress・完了）をCoreから呼出元へ届ける

JSON-RPC 2.0 を採るのは、request/response/notification のフレーミング・id相関・error形状を自前で発明せず済むため。WebSocketは配送路、JSON-RPCはメッセージ形式、queue/hook操作はその上のpayload、と役割を分ける。

## Operations and schemas

未定。少なくとも以下を JSON-RPC の method/notification として定義する予定:

- session確立・維持（接続開始方向、再接続時の状態復元）
- Catalog取得（Tool/UI宣言）
- Tool呼出・Streaming出力（queue/hook/resultメッセージ）
- Node宣言（`docs/architecture/00001`）

## Error, ordering, and lifecycle semantics

- エラーは JSON-RPC 2.0 標準の error object に従う方針
- メッセージ順序保証・切断中の未配送・再接続時のreplayの有無は未確定
- tool-level error と routing/transport error の分離（旧実装でも維持していた区分）は引き継ぐ方針

## Security and conformance

- 呼出元IdentityをProtocol上どう扱うかは未確定。旧実装はCoreがsessionから判断し、呼出先Pluginには渡さなかった（caller自己申告は認可に使えない、という立場）
- `standard` PluginのNodeごと最大1登録制約（`docs/architecture/00001`）を本contractでどう表現するかは未確定

## Open questions

- 接続開始方向: 旧実装は `Core → Plugin` 固定・逆接続禁止（旧ADR-0024）。WebSocket化でPlugin開始の接続を認めるかは要決定 — 到達性・登録モデルに影響する
- 認証・暗号化の扱い（ローカル接続を基本とする限り別contractで扱う想定）
