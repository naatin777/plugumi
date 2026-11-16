---
type: decision
title: "通信transport: REST基本 + WStransport"
description: Core↔Plugin通信をHTTP/1.1+JSON RESTとWebSocket+JSON-RPC 2.0の2層で構成する理由。gRPC・Connect等の不採用理由を含む。
status: draft
relations:
  contract:
    - '00001'
    - '00002'
---

## コンテキスト

Core↔Plugin通信のtransportとメッセージ形式を決める必要がある。旧実装では方針が段階的に変わってきた:

- 当初: gRPC/Protobuf 双方向Stream（後に廃止）
- その後: HTTP/JSON + Session Handshake（旧ADR-0079。当時WebSocketを明示的に不採用）
- 本設計: WebSocket + JSON-RPC 2.0 のtransportを追加（旧ADR-0024の接続方向は継承）

これは通信モデルの変化であり、接続方向等の設計判断まで変わったわけではない。前提となる要件:

- Plugin serverは**多様な言語で書ける**ことが必須。言語によって得意不得意があるため、Plugin実装言語を絞らない
- request/responseで足りる処理（宣言・検索・Link管理）と、push・途中出力が要る処理（Tool呼び出しの中間出力等）が混在する
- Plugin→Core方向の送信は「いつでも・継続的に」起こり、RESTのrequest/responseでは表しにくい

## 決定

- **基本は HTTP/1.1 + JSON のREST**（`docs/contracts/00001`）。OpenAPI化も見据える
- **transportは WebSocket + JSON-RPC 2.0**（`docs/contracts/00002`）。Tool呼び出し・途中出力等、request/responseで表せない送信をここに載せる
- JSON-RPC 2.0 は基本的な Request・Response・Notification の形だけを提供する。途中出力・Queue・通知・キャンセル等のPlugumi固有の振る舞いは別のContract/Designで定義する（呼び出し形態は `docs/contracts/00003` で定義）

## 代替案

| 候補 | 不採用理由 |
|---|---|
| **gRPC** | 本命候補だったが不採用。gRPCはHTTP/2を必須とし、HTTP/1.1のRESTとの同居は条件付きながら可能だが、実装・運用上の考慮が増える。多様な言語で書くPlugin serverには負担が重い。また双方向Streamは「双方が独立したRPCを開始する」モデルではなく対称性が違う。動的に登録されるToolには静的なProtobuf定義が合いにくく、JSON Schemaとの二重管理になる。gRPC-Webは双方向Streamingに制約がある |
| **Connect** | ブラウザ・gRPC両対応で有力だが、対応言語がまだ狭い。Plugin serverを多様な言語で書ける前提と衝突する |
| **WS一本** | 全部をWSに載せるとREST/OpenAPIの資産が使えず、request/response中心の処理まで常時接続が前提になる |
| **REST一本（SSE等でpush）** | 一方向pushは可能だが、Plugin→Coreの継続的な送信や双方向対称性が弱い |

## トレードオフと帰結

- transportが2系統になるため、Core・PluginともHTTP serverとWS client/serverの両面を実装する。ただし各面は独立して薄く保てる
- 「どの操作がどちらに載るか」の分類が契約設計の論点になる。request/response中心はREST、Tool呼び出し・途中出力・通知はWS、という基準を明確にする（`docs/contracts/00003`）
- JSON-RPC 2.0の採用はメッセージ形式としての決定であり、WS固有ではない。REST側のoperationを後でWSに載せ替えることも形式上一貫する
