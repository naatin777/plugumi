---
type: design
title: Tool登録・Discovery・呼び出しルーティング
description: linkId と toolPath によるTool識別、Node対応、Discoveryから厳格呼び出しまでの設計。呼び出し系は後続contractで具体化する。
status: draft
relations:
  requirement:
    - '00002'
---

## 対応するrequirement

`docs/requirements/00002`: 選択を呼び出し元Pluginの責務としつつ、Coreが厳格なルーティングと権限検証を担うための識別・検索・転送モデル。

## モデルと不変条件

- **linkId**: `link.hello` 時にCoreが発行する一意ID。同一Plugin実装を複数登録（複数Node・同一Node上）できる
  - **MVPではlink-scoped**（`docs/decisions/00004`）: 接続のたびに新IDを払い出し、切断で失効する。旧実装の「再起動後も同一登録を維持する永続ID」は将来の拡張とする
  - Plugin実装のグローバル一意IDは要求しない。`plugin.id` は参考情報として保持するだけ
- **Node**: Pluginが宣言する「実行環境」の共有識別。宣言method・Link対応は後続contractで定義する。Coreは意味を解釈しない
- **toolPath**: 登録内で一意なTool識別子。構造（`seg/seg` 階層かflatか）は open question
- **Tag**: Toolに複数設定できる検索用ラベル。宣言側が自由に付ける案。Coreが語彙を管理するかは未確定

## 振る舞い

1. **宣言**: Pluginが `tools.set` でTool一覧をアトミックに宣言する（`docs/contracts/00001`、MVP仕様として定義済み）。Node宣言は後続contract
2. **Discovery**: 呼び出し元Pluginが検索し、結果は `linkId + toolPath` を基本とする。Node等の追加情報は必要に応じて別APIから取得する（method形・tag/schemaのマッチング条件は後続contract。schema適合も対象に入れる方針）
3. **選択**: 呼び出し元Pluginが候補をフィルタリングし、Default管理・選択UI・単発/複数判断を行う。Coreは候補を選ばない
4. **Tool Call**: `linkId + toolPath` を指定して呼び出す。Coreが対応Linkへルーティングする（wireは `docs/contracts/00003`）
5. **途中出力**: callId相関のnotificationとして中継する（`docs/contracts/00003`）。payload形状は後続contract

失敗パス: 未登録の linkId・解決不能な toolPath・呼び出し不能はrouting/transport errorとして返す。Tool内部の失敗とは分離する。Coreが別候補・別Nodeへ暗黙退避しない。

## インターフェース

- 接続・Link・Tool宣言は `docs/contracts/00001`・`00002`（WebSocket + JSON-RPC 2.0 に統一。Pluginは受動で、Coreが接続を開始する）
- Tool Call・途中出力・購読・closeは `docs/contracts/00003`
- Discovery・Node宣言のmethod形は後続contractで定義する

## 未解決の問い

- `toolPath` の構造（`seg/seg` 階層かflatか）
- `kind` を Discovery の条件・結果に含めるか
- Tag の語彙管理（宣言側自由記述か、Coreが管理するか）
- 実行時権限検証を最小限（hello済み呼び出しのみ）以上に広げるか
- 呼び出し元identityを対象Pluginへ伝えるか
- linkId の永続化を将来導入する場合の再登録キー（実装ID+任意ラベル等）
- Node宣言の粒度（NodeごとのCapability差分を表現するか）
