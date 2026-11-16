---
type: design
title: Session Registry の設計（MVP）
description: Coreが保持するSession/Registration状態の構造・寿命・失効処理。
status: draft
relations:
  requirement:
    - '00002'
  contract:
    - '00001'
  decision:
    - '00004'
---

## 対応するrequirement

`docs/requirements/00002`（厳格な呼出先指定）は `registrationId` で宛先を一意に識別する設計であり、そのregistrationIdを保持・失効させる本体が本designのSession Registryである。`docs/contracts/00001` のSession lifecycleをCore内部のデータ・振る舞いとして定義する。

## モデルと不変条件

Coreはメモリ上に **Session Registry** を持つ。永続化しない（`docs/decisions/00004`、session-scoped決定）。

```
Session {
  sessionId        // Core発行、Session識別
  registrationId   // Core発行、Tool呼出の宛先識別
  plugin: { id, version?, name? }   // session.hello応答の識別情報
  endpoint         // Pluginの接続先（Core→Plugin REST用）
  tools: ToolDecl[]        // tools.set で置き換えられる宣言リスト
  nodes: NodeDecl[]        // Node宣言は後続contract
  lastPingAt       // session.ping の最終受信時刻
  state: active | expired
}
```

不変条件:

- `sessionId`・`registrationId` はSessionごとに新規発行・再利用しない
- `tools` は `tools.set` によるアトミック置き換えのみで変化する
- Session失効時、registrationId・tools・nodesは同時に消える
- Core再起動でregistryは空になる

## 振る舞い

1. **確立**: `session.hello` 成功で entry を `active` として登録する
2. **維持**: Pluginが `session.ping` を定期送信する（MVP目安: 30秒間隔）。Coreは受信ごとに `lastPingAt` を更新する
3. **失効**: `lastPingAt` から一定時間（MVP目安: 90秒 = ping 3回分）経過したSessionを `expired` にし、registryから除去する
4. **再試行**: 設定で指定されたPlugin Endpointへの接続失敗は、Coreが一定間隔で再試行する（Session未成立状態は registry entryを持たない）

## インターフェース

- `session.hello` `tools.set` `session.ping`（`docs/contracts/00001`）のCore側処理として実装する
- 標準出力でregistryの一覧を表示する（MVPの可視化）

## 未解決の問い

- `session.bye` による明示終了を入れるか
- 失効間隔・ping間隔の確定値
- 同一Plugin実装の複数Session（重複Endpoint設定・手動複数起動）をどう扱うか — MVPではそのまま別Sessionとして登録する想定
