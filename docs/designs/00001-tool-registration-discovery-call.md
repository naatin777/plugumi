---
type: design
title: Tool登録・Discovery・呼出ルーティング
description: registrationId と toolPath によるTool識別、Node対応、Discoveryから厳格呼出までの設計。
status: draft
relations:
  addresses:
    - '00002'
---

## Requirements addressed

`docs/requirements/00002`: 選択を呼出元Pluginの責務としつつ、Coreが厳格なルーティングと権限検証を担うための識別・検索・転送モデル。

## Model and invariants

- **registrationId**: 各Plugin登録に付与する一意ID。同一Pluginを複数Node・同一Nodeに複数登録できる。例外として `standard` PluginはNodeごと最大1登録（旧実装の既存仕様。再検証対象）
  - 旧実装から引き継ぐ性質: Coreが発行し、再起動・Endpoint変更後も同一登録の対応を維持する永続ID。Plugin実装のグローバル一意IDは要求しない — 同一実装の複数登録を妨げない
- **Node**: Pluginが宣言する「実行環境」の共有識別。ローカルホスト・Docker sandbox・リモートPCなどを含む。CoreはNodeの意味を解釈せず、registrationId と Node の対応を管理する
- **toolPath**: 登録内でのTool識別子。呼出は `registrationId + toolPath` の組で厳格に指定する
- **Tag**: Toolに複数設定できる検索用ラベル

## Behavior

1. **Discovery**: 呼出元Pluginが Tag + Input Schema + Output Schema で検索する。結果は基本的に `registrationId + toolPath` のみ。Node等の追加情報は必要に応じて別APIから取得する
2. **選択**: 呼出元Pluginが候補をフィルタリングし、Default管理・選択UI・単発/複数判断を行う。Coreは候補を選ばない
3. **Tool Call**: `registrationId + toolPath` を指定して呼び出す。Coreが対応するNode・Pluginへルーティングする
4. **検証**: 実行時にCoreが権限を検証する

失敗パス: 未登録の registrationId・解決不能な toolPath・権限不足は呼出失敗として返す。Coreが別候補・別Nodeへ暗黙退避しない。

## Interfaces

- 通信は `docs/contracts/00001`（WebSocket + JSON-RPC 2.0）経由
- Discovery・Node情報取得・Tool Call の個別method名はcontract側で定義する予定

## Open questions

- Tag の付与方法（宣言側が自由に付けるか、Coreが語彙を管理するか）
- Node情報を返す別APIの形状
- 実行時権限検証の具体モデル（`docs/decisions/00001` の信頼モデルとの整合）
- Node宣言の形態（旧実装はsession-scoped・実行時メモリのみのRegistry。継続するか）
- toolPathの構造（旧実装は階層TreeのLeaf+Namespaceモデル。引き継ぐか）
